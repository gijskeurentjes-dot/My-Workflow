# AI Islands

A visual workspace for a team of AI agents. Five agents live on five islands; you
can see at a glance which projects exist, who is working, what they are doing,
what is waiting, what is finished, and where you need to make a decision.

> **Nothing here calls an AI model yet.** The agents are driven by a mock engine
> on the server. Progress, walking, approvals and deliveries are produced by a
> state machine — but the *states*, the *transitions* and the *events* are the
> real ones, so the simulation can be swapped for real Claude agents without
> rewriting the interface. See [Replacing the mock agents](#replacing-the-mock-agents).

---

## Quick start

Requires Node 20 or newer.

```bash
npm install
cp .env.example .env       # optional; the defaults work as-is
npm run dev
```

Then open **http://localhost:5173**.

`npm run dev` builds the shared package, starts the API on port 4000 and the
Vite dev server on 5173. The dev server proxies `/api` to the backend, so the
browser sees a single origin and the event stream needs no CORS negotiation.

On first run the database is created and seeded with a demo world. You can
rebuild it at any time from **Settings → Reset demo data**, or from the command
line with `npm run db:reset`.

### Other commands

| Command             | What it does                                             |
| ------------------- | -------------------------------------------------------- |
| `npm run dev`       | Shared build + API + web dev server                       |
| `npm run build`     | Production build of all three packages                    |
| `npm test`          | Server test suite (Vitest)                                |
| `npm run typecheck` | Typecheck every package                                   |
| `npm run db:reset`  | Drop, re-migrate and re-seed the database                 |

---

## One project is one island

A **project is an island**, and every project has **its own team**. Teams are
independent: an agent works its own project's board and never quietly picks up
someone else's work.

Every island has the same eight places, and a task's *kind of work* decides
which building it is carried out at:

| Place | What happens there | Kind of work |
| ----- | ------------------ | ------------ |
| **Headquarters** | Coordination, and where finished work waits for your approval | Planning, review |
| **Research Library** | Sources, reading, written reports | Research |
| **Workshop** | Code, builds, tests | Development |
| **Presentation Studio** | Decks, storylines, charts | Presentation |
| **Data Workshop** | Workbooks, formulas, models | Data & analysis |
| **Meeting Circle** | Where agents wait between jobs, and waiting work is pinned | — |
| **Delivery Depot** | Approved work, crated and logged | — |
| **Gate** | The way on and off the island | — |

## The agents

You hire agents onto a project from five archetypes:

| Archetype | Default name | Works from | Naturally owns |
| --------- | ------------ | ---------- | -------------- |
| **Project Manager** | Atlas | Headquarters | Planning, review |
| **Researcher** | Nova | Research Library | Research |
| **Developer** | Forge | Workshop | Development |
| **Presentation Designer** | Slidebuilder | Presentation Studio | Presentations |
| **Spreadsheet & Data Analyst** | Excel Expert | Data Workshop | Data & analysis |

An archetype is a starting point, not a cage. Each agent stores its own **role**,
**instructions** and **tools**, all editable on its page — so two projects can run
very different Developers. Those three fields are not decoration:

- **instructions** is what a live engine sends as that agent's **system prompt**
- **tools** is what it is allowed to reach for
- both live in the database, so an agent's behaviour changes without a deploy

Archetypes live in
[`packages/shared/src/archetypes.ts`](packages/shared/src/archetypes.ts); each
agent's own brief lives in its row.

---

## Screens

| Route | Screen |
| ----- | ------ |
| `/` | Visual workspace — every project island, live |
| `/projects` | Project list |
| `/projects/:id` | The project's island, its team, its board and its activity |
| `/tasks` | Task board across every project |
| `/agents` | Every agent, grouped by project |
| `/agents/:id` | Agent details: status, history, and its editable brief |
| `/approvals` | Approval queue |
| `/activity` | Event log |
| `/settings` | Appearance, engine status, demo reset |

### Accessibility

The animated world is the *pleasant* way to read the state; it is never the
*only* way. Every island card, agent and task is also a real, labelled element
in a list or panel, reachable by keyboard and announced by a screen reader.
Agents in the world are focusable SVG nodes with descriptive labels, and the
whole interface respects `prefers-reduced-motion`.

---

## Architecture

```
packages/shared/   Types, bot roster, island geometry, the SSE event contract
packages/server/   Express + SQLite, repository layer, the agent engine
packages/web/      React + TypeScript + Vite
```

Full detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The two decisions
that matter most:

**The persistence seam.** Every data operation is declared as an interface in
`repositories/types.ts`; `repositories/sqlite/` implements it. Services, routes
and the agent engine depend only on the interfaces, so adding PostgreSQL means
writing a second set of implementations and changing no callers. Schema changes
ship as numbered migrations that run on startup and are checked for foreign-key
violations before they are accepted.

**The simulation split.** The server owns authoritative state — status, which
place an agent is at, task progress — and pushes it over Server-Sent Events at
2 Hz. The client owns *animation*: it interpolates the walk between two places
using the same shared pathfinding the server used to plan it. Streaming
positions frame by frame would be wasteful, and this split is exactly what keeps
the UI unchanged when real agents take over.

---

## Replacing the mock agents

`MockAgentEngine` implements the `AgentEngine` interface in
[`packages/server/src/services/agents/agent-engine.ts`](packages/server/src/services/agents/agent-engine.ts):

```ts
export interface AgentEngine {
  readonly kind: string;
  start(): void;
  stop(): void;
  tick(now?: number): EngineChanges;
  info(): EngineInfo;
}
```

A real engine implements the same interface, calls actual agents, and reports
what changed as `EngineChanges`. The wiring already exists: set `AGENT_ENGINE`
and add the branch in `buildEngine()` in `context.ts`. Today `AGENT_ENGINE=claude`
throws a clear error rather than pretending, because silently doing nothing
would be worse.

Nothing in `packages/web` needs to change. Every screen consumes bot status and
task progress through the SSE contract, which is identical either way.

---

## Configuration

Copy `.env.example` to `.env`. The defaults work without it.

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `PORT` | `4000` | API port |
| `DATABASE_URL` | `file:./data/ai-islands.sqlite` | SQLite file; relative paths resolve from `packages/server` |
| `AGENT_ENGINE` | `mock` | Which engine drives the world |
| `MOCK_AUTO_ASSIGN` | `true` | Whether idle agents pick work off the board unprompted |
| `AGENT_TICK_MS` | `500` | How often the engine advances the world |
| `CORS_ORIGIN` | `http://localhost:5173` | Browser origin allowed to call the API |

Secrets belong in `.env`, which is gitignored. `ANTHROPIC_API_KEY` is listed in
`.env.example` as a commented placeholder for the real engine; nothing reads it
yet.

---

## What you can do

Everything in the brief's required behaviour is working:

| | Where |
| --- | --- |
| Create a project | **Projects → New project** — picks its island and starting team |
| Hire an agent onto a project | **＋ Hire**, on the project page |
| Dismiss an agent | On the agent's page |
| Edit an agent's brief | **Edit** on the agent's page — role, system prompt and tools |
| Set a task's priority | **Priority** on any task card — urgent work is picked up first |
| View a project | **Projects →** any card |
| Create tasks | **New task**, on the task board or inside a project |
| Assign a task to an agent | **Assign** / **Reassign** on any task card |
| Start a task | **Start** on a task that is on the board |
| Pause a task | **Pause** on running work — progress is held, not lost |
| Cancel a task | **Cancel** — progress is kept for the record |
| Mark a task as requiring approval | The checkbox when creating it, or on the task |
| Approve or reject | **Approvals**, or straight from the task card |
| View task progress | Progress bars, live, everywhere a task appears |
| View bot status | **The team**, the workspace rail, or any agent's page |
| View recent activity | **Activity**, and per-project and per-agent feeds |
| Reset demo data | **Settings → Reset demo data** |

### How the work actually flows

1. A task is created on a project. Its **kind of work** decides which building
   on that project's island it happens at, and which archetype naturally owns it.
2. You assign it to someone on that project's team. An agent given work on
   another project **transfers there**, arriving at the gate.
3. On **Start**, the agent walks to the Workbench and progress begins.
4. At 100% it either carries the work to the **Approval Post** and waits for
   you, or — if the task does not need approval — heads straight for the depot.
5. **Approve** and the agent walks the work to the **Delivery Depot**. Arriving
   there is what completes the task, adds a crate and writes the log line.
   **Request changes** reopens the work with your note attached, and the agent
   carries on from where it was.

Nothing skips a step: approving does not complete a task on its own, and an
agent never delivers work that needs sign-off without it.

---

## Current state

Milestones 1 and 2 are complete. The world runs, and you can drive it.

- Multiple projects, each its own island with its own team
- Multiple agents per project, hired and dismissed at will
- Per-agent role, instructions and tools, stored and editable
- Task priority, which orders the board and decides what is picked up first
- Mock engine driving all seven agent states, ticking at 2 Hz
- Full command API: projects, agents, tasks, execution and approvals
- Live updates over Server-Sent Events, with automatic reconnection
- Every screen rendering and mutating real data
- 84 server tests

Still to come:

- Real Claude agents behind the existing `AgentEngine` interface
- Authentication, and more than one world
- Retention on the activity log
