# Architecture

How AI Islands is put together, and why. The guiding constraint is the one from
the brief: **build it with mock agents now, in a shape that lets real Claude
agents replace them without rewriting the interface.**

---

## Packages

```
packages/shared/   @ai-islands/shared
packages/server/   @ai-islands/server
packages/web/      @ai-islands/web
```

An npm-workspaces monorepo, so the contract between client and server is a
compile-time guarantee rather than a convention. If the server changes the shape
of a bot, the web build fails — it cannot drift into a runtime surprise.

### `shared` — the contract

| File | Contents |
| ---- | -------- |
| `types.ts` | Domain entities and the DTOs on the wire |
| `status.ts` | The seven agent states and eight task states, with labels and colour tones |
| `bots.ts` | The five agent profiles, and which task type each owns |
| `islands.ts` | Island definitions and the biome palettes, light and dark |
| `geometry.ts` | Isometric projection, terrain generation, roads, pathfinding |
| `events.ts` | The Server-Sent Events contract |
| `derive.ts` | Derivations both sides need, defined once |

`geometry.ts` is shared for a specific reason: the **server** uses `findPath` to
work out how long a walk takes, and the **client** uses the same function to draw
that walk. One copy means an agent can never be animated along a route the
server did not plan.

### `server`

```
config.ts                     Environment, validated and resolved once
context.ts                    Wires everything together; what tests construct
db/migrations.ts              Versioned schema, recorded in schema_migrations
db/sqlite.ts                  Connection and migration runner
db/seed.ts                    The demo world
repositories/types.ts         The persistence seam  ← PostgreSQL slots in here
repositories/sqlite/          The SQLite implementation
services/world.service.ts     The read side: snapshots, stats, joined views
services/agents/              The agent engine seam  ← real agents slot in here
realtime/broadcaster.ts       The SSE hub
routes/                       One router per resource
```

### `web`

```
api/client.ts                 REST calls (only the reset mutation today)
world/WorldProvider.tsx       The client's copy of the world; SSE reducer
world/selectors.ts            Derived views: joins, grouping, interpolation
world/useAnimationClock.ts    A per-frame clock, reduced-motion aware
world/scene/                  The isometric SVG renderer
components/ui.tsx             Status pills, avatars, progress bars, the feed
screens/                      One file per screen
App.tsx                       Shell, navigation, routing, the loading gate
```

---

## The two seams

Everything else is ordinary. These two are what the brief actually asked for.

### 1. Persistence

`repositories/types.ts` declares every data operation as an interface:

```ts
export interface Repositories {
  islands: IslandRepository;
  bots: BotRepository;
  projects: ProjectRepository;
  tasks: TaskRepository;
  approvals: ApprovalRepository;
  activity: ActivityRepository;
  transaction<T>(fn: () => T): T;
  reset(): void;
}
```

`createSqliteRepositories(db)` returns one. Services, routes and the engine
receive it and never touch the driver. Adding PostgreSQL means writing
`createPostgresRepositories(pool)` with the same return type.

The schema is deliberately portable: TEXT ids, INTEGER epoch-millisecond
timestamps, and CHECK constraints instead of native enums. All of it is valid
PostgreSQL.

One detail worth knowing: `BotPatch` accepts an optional `updatedAt`. The agent
engine passes its own tick time on every write, so durations it measures against
`updatedAt` stay correct under a controlled clock. Without it, the engine's
notion of "now" and the repository's `Date.now()` silently disagree wherever the
clock is injected — which is every test.

### 2. The agent engine

```ts
export interface AgentEngine {
  readonly kind: string;
  start(): void;
  stop(): void;
  tick(now?: number): EngineChanges;
  info(): EngineInfo;
}
```

`tick` is exposed separately from `start` for two reasons: tests step it
deterministically with a fake clock, and a future engine can be driven by agent
callbacks rather than a timer.

`EngineChanges` reports only rows that actually changed, so the SSE stream stays
small as the world grows. `ChangeSet` accumulates them, keeping one entry per
row — a bot touched three times in one tick is broadcast once, in its final
state.

#### What the mock engine does each tick

For every task that can still advance:

1. **In transit?** If the arrival time has not passed, do nothing. Otherwise
   arrive, and act on where it landed.
2. **In the wrong place?** Plan a walk with the shared `findPath` and record
   `{ fromKey, toKey, departedAt, arrivesAt }`.
3. **Standing in the right place?** Do the work of that state. Working advances
   progress by `(100 / durationSeconds) × elapsed`.

At 100%, a task either raises an **approval request** and the agent carries it
to the Approval Post, or — if it does not need approval — walks straight to the
depot. Arriving at the depot with work in hand is what completes a task: the
crate count goes up, the agent is freed, and a `delivered` event is written.

Elapsed time is clamped to five seconds, so a process that was suspended for a
minute does not finish every task at once when it wakes.

Idle agents pick work off the board on their own (`autoAssign`, on by default),
which is the mock stand-in for Atlas delegating. A real engine would ask the
project manager agent to make that call.

---

## Realtime

One `EventSource` connection feeds the entire client. There is no polling
endpoint on purpose: a single path for live state means the world view, the task
board and the approval queue cannot disagree about what an agent is doing.

On connect the server sends a full `snapshot`; after that it sends deltas.

```
snapshot   the whole world, once, on connect
tick       bots and tasks that changed, plus fresh stats
activity   new event-log rows
approvals  the approval queue, when it changes
islands    islands, when a crate count changes
engine     engine started, stopped, or swapped
heartbeat  keep-alive; also re-measures clock skew
```

### One trap worth documenting

The server sends **named** SSE events (`event: tick`). A named event does *not*
reach `EventSource.onmessage` — a listener must be registered for that name.
Getting this wrong produces the worst kind of bug: the connection opens
successfully, the server writes happily, and no event is ever handled.

`SERVER_EVENT_TYPES` in `shared/events.ts` is the list the client iterates to
register listeners, and it carries a compile-time exhaustiveness guard. Adding a
variant to `ServerEvent` without adding it to the list is a build error rather
than an event that silently never arrives.

### Clock skew

Walks are interpolated from server timestamps, so a client whose clock is wrong
would place agents in the wrong place. Every `snapshot` and `heartbeat` carries
the server time; the client keeps the difference and corrects for it before
interpolating.

### The simulation split

| Owner | Responsibility | Rate |
| ----- | -------------- | ---- |
| Server | Status, location, task progress — the authoritative state | 2 Hz over SSE |
| Client | The walk between two places, gait, breathing, blinking | 60 fps locally |

The server says "walking from Rest Point to Workbench, arriving at T". The
client draws the journey. This is what lets a 2 Hz stream render as smooth
movement, and it is why the frontend needs no change when real agents take over:
it never knew what was producing the state in the first place.

---

## Rendering

The world is **SVG**, not canvas. Every island, place and agent is a real DOM
node, which means agents are focusable and screen-reader labelled for free —
directly serving the brief's requirement that the interface not depend on
animation alone.

Terrain is generated from a seed rather than stored: a deterministic distance
field with an angular wobble produces the coastline, value noise raises hills
away from the roads, and the coast is traced analytically as a smooth spline
rather than stepped tiles. The same seed always produces the same island, on
every machine and after every reset.

Biome palettes are defined once for light and derived for dark by mixing toward
a single night colour, so a new biome cannot be accidentally inconsistent
between themes.

---

## Testing

Server tests use Vitest against an in-memory SQLite database. `createTestWorld()`
builds a complete, isolated world; `fastForward(seconds)` and
`fastForwardUntil(predicate)` step the engine with a fake clock, so a two-minute
task finishes in microseconds and no test sleeps or flakes.

The suite covers the seed's integrity (every agent has a home, every task is
routed to the right island, bot and task agree on who holds what) and the
engine's behaviour — including the things that would be most damaging if they
broke: that finished work asks for approval instead of completing itself, that
exactly one approval request is raised, that paused and blocked work does not
advance, and that two agents never hold the same task.

---

## Deliberate omissions

Called out so they read as decisions rather than oversights.

- **No authentication.** There is no concept of a user yet; the world is
  single-tenant.
- **No write API beyond reset.** Milestone 1 is read-only by design; the
  mutation routes arrive with the controls that use them.
- **No optimistic UI.** With mutations landing next, the pattern to use is worth
  choosing alongside them rather than in advance.
- **Activity log is unbounded.** Fine for a demo; a production build would need
  retention.
