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
| `status.ts` | The eight agent states and nine task states, with labels and colour tones |
| `archetypes.ts` | The five archetypes, and which task type each owns |
| `appearance.ts` | Biome palettes (light and dark) and how a project's island is chosen |
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
services/workflow.service.ts  The command side: every transition you can trigger
services/agents/              The agent engine seam  ← real agents slot in here
services/agents/claude/       Nova: the runner, its limits, the API client
services/task-execution.service.ts  Runs one task against a real agent
scripts/run-nova.ts           The command-line test task
errors.ts                     WorkflowError, carrying the HTTP status with the rule
realtime/broadcaster.ts       The SSE hub
routes/                       One router per resource
```

### `web`

```
api/client.ts                 Reads and the whole command API
world/CommandProvider.tsx     Running commands: pending state, refusals, toasts
world/WorldProvider.tsx       The client's copy of the world; SSE reducer
world/selectors.ts            Derived views: joins, grouping, interpolation
world/useAnimationClock.ts    A per-frame clock, reduced-motion aware
world/scene/                  The isometric SVG renderer
components/ui.tsx             Status pills, avatars, progress bars, the feed
components/TaskCard.tsx       One task, with the controls its status allows
components/Dialog.tsx         Modal with focus handling
components/CreateDialogs.tsx  New project and new task forms
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
  projects: ProjectRepository;
  agents: AgentRepository;
  tasks: TaskRepository;
  approvals: ApprovalRepository;
  activity: ActivityRepository;
  results: TaskResultRepository;
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

#### The real runtime, beside it

There is a second path that does not go through the engine at all.
`TaskExecutionService` takes a task id and runs it against a real model, and the
seam it depends on is one method:

```ts
export interface AgentRunner {
  readonly archetype: string;
  run(context: AgentRunContext, emit: RunEventSink, signal: AbortSignal): Promise<AgentRunResult>;
}
```

A run is one thing, so it is one method; cancellation arrives through the signal
rather than a second call, which is what lets it compose with the SDK's own
abort handling and with the deadline the service sets.

Three decisions are load-bearing:

- **The context is assembled before the model is called.** The runner is handed
  exactly one agent, one task and one project, and has no way to reach a second
  one even if the model asks for it. Project scope is a property of what gets
  loaded, not a rule the model is asked to follow.
- **The tool allow-list is resolved server-side from the agent's stored brief.**
  That brief is editable in the UI, so it is not trusted: a forbidden tool is a
  refusal before the run starts, and only `web_search` is ever handed over.
- **It writes the same states the mock does.** A live run is `working`, then
  `waiting_approval` or `delivering`, then whatever you decide. Nothing
  downstream branches on which engine produced a row.

`buildAgentRunners()` returns an empty map when no credentials are configured,
so the application is identical with and without a key — the difference is
whether an execution request is possible, not whether the app starts.

Research runs in two phases (search, then structure) so that the call which
produces the typed report cannot be the one that invents a source; the report's
sources are then checked against the URLs actually retrieved. See
[AGENTS.md](AGENTS.md).

---

## The world model

**A project is an island.** It carries its own appearance — biome, terrain seed
and position on the world map — fixed at creation so an island someone has
learned to recognise never changes shape underneath them.

**Every project has its own team.** Agents belong to a project, not to the
world, and the engine only ever offers an agent work from its own project's
board. Hiring adds one; dismissing puts whatever it held back on the board.

**An agent's archetype is a starting point, not a cage.** It sets the sprite,
the natural task types and the brief the agent begins with. `role`,
`instructions` and `tools` are then stored per agent and editable — which is what
makes the Claude swap meaningful, because `instructions` is literally the system
prompt a live engine would send.

**A task's kind of work decides where it happens.** `TASK_TYPES` maps each type
to a building on the island, and the engine walks the agent there. That mapping
is the single source of truth: the server routes with it, and the world view
uses it to explain why an agent walked somewhere.

### Migrating to it

The model changed after two milestones had shipped, so migration 3 reshapes
existing databases in place rather than resetting them: projects gain island
appearance, `bots` becomes `agents` re-keyed onto projects, and tasks, approvals
and activity are rebuilt with the new columns.

Reshaping a schema in SQLite means rebuilding tables — create the new shape,
copy the rows, drop the old, rename — and with foreign keys enforced, a table
whose parent has already been rebuilt cannot be altered at all. `migrate()`
therefore turns enforcement off for the duration and runs `foreign_key_check`
before accepting the result: nothing commits as clean without passing it.

Existing agents belonged to a work area rather than a project, so there was no
correct project for them. They join the oldest one, and that choice is written
down in the migration rather than left to be discovered.

---

## Two sides, one path out

The world changes for two reasons: the engine advances work on its own, and you
issue a command. `WorkflowService` is the second one. Both write through the
same repositories and both report what changed as `EngineChanges`, so a task
started by hand and a task picked up automatically are indistinguishable
downstream.

Every rule about which transition is legal lives in `WorkflowService`. Routes
translate HTTP into a call and nothing more; the UI disables buttons only as a
courtesy. A refusal comes back as a `WorkflowError` carrying its own status —
`409` for an illegal transition, `404` for something missing, `400` for a bad
body — and the client shows the sentence it came with, because "Only work in
progress can be paused — this task is paused" is more use than a greyed button.

Each action is its own endpoint (`POST /api/tasks/:id/pause`) rather than a
status field a client could set to anything. The legal transitions stay on the
server.

### Commands publish through the stream, not through their responses

`routes/helpers.ts` wraps every write: run the command, hand its changes to
`ctx.publish`, answer. Mutations deliberately do *not* merge their own responses
into client state — the same command has already broadcast over SSE, and letting
that single path do the updating keeps every open screen in step. Two browsers
watching the same board both move when either one clicks.

### One invariant worth naming

A pending approval request whose task has moved on is a card in the queue that
can never be approved. Four things take work out of `waiting_approval` without
you deciding: cancelling it, resetting it, taking it off its agent, and
reassigning that agent to something else. All four go through
`withdrawApproval`, and a test pins each one — plus a churn test that runs
commands and ticks together and asserts the queue stays coherent throughout.

The work is not lost when this happens: the task keeps its progress and goes
back on the board, so it finishes again immediately and asks for your decision a
second time.

Deleting is the odd case: the approval row is cascade-deleted with its task, so
there is no row to broadcast. `EngineChanges.approvalsChanged` is the flag that
refreshes a queue someone is looking at.

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

The real agent runtime is tested the same way, and **no test reaches the
network**. The Anthropic client is replaced by a fake that encodes the real
response shapes — a web search result is a list on success and an object on
error, usage is snake_case, a refusal arrives as HTTP 200 with
`stop_reason: 'refusal'` — because a fake that gets those wrong would let the
tests agree with a bug. On top of that sit the things worth being sure of: that
a source cited but never retrieved is flagged, that a paused turn is resumed
rather than half-answered, that a run past its time limit is stopped, that
cancellation frees the agent, and that an agent asking for a forbidden tool or
another project's work is refused before a single token is spent.

---

## Deliberate omissions

Called out so they read as decisions rather than oversights.

- **No authentication.** There is no concept of a user yet; the world is
  single-tenant.
- **No optimistic UI.** Commands wait for the server and update through the
  stream. Locally that is a few milliseconds; over a slow link a button shows a
  pending state. The alternative — predicting the result client-side — would
  mean duplicating the transition rules in the browser, which is exactly what
  keeping them in one place is meant to avoid.
- **No undo.** Cancelling keeps a task and its progress, and deleting asks
  first, so the destructive paths are recoverable or guarded rather than
  reversible.
- **Activity log is unbounded.** Fine for a demo; a production build would need
  retention.
- **Only the Researcher is real.** The other four archetypes have no live
  runner, and asking to execute one is refused rather than silently simulated.
- **Live execution is not wired into the visual world.** It runs from the
  command line and the API only, so the backend can be proven on its own before
  a button exists for it.
- **No cost ceiling in currency.** A run is bounded by time, output tokens and
  searches, which are the levers actually available; converting those to a
  spend limit would need per-model pricing that does not belong in this build.
