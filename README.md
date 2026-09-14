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

## The five agents

| Agent            | Role                        | Home island         | Owns          |
| ---------------- | --------------------------- | ------------------- | ------------- |
| **Atlas**        | Project Manager             | Headquarters        | Planning, review |
| **Nova**         | Researcher                  | Research Library    | Research      |
| **Forge**        | Developer                   | Workshop            | Development   |
| **Slidebuilder** | Presentation Designer       | Presentation Studio | Presentations |
| **Excel Expert** | Spreadsheet & Data Analyst  | Data Workshop       | Data & analysis |

Each agent carries the three things a real agent would need, and they are not
decoration — a live engine reads the same fields:

- **responsibilities** — what becomes its system prompt
- **tools** — what it is allowed to reach for
- **approvalRules** — what it must always check with you about

They live in [`packages/shared/src/bots.ts`](packages/shared/src/bots.ts).

### Islands, projects and tasks

An **island is a work area**, not a project. A **project** is a body of work
whose tasks are spread across the islands: a task's *kind of work* decides which
island it is carried out on and which agent naturally owns it. So a single
project can have Nova researching in the Library, Forge building in the
Workshop, and Slidebuilder drafting in the Studio at the same time.

Every island has the same five places, and an agent walks between them:

| Place | What happens there |
| ----- | ------------------ |
| **Workbench** | Where the work is actually done |
| **Approval Post** | Finished work waits here until you decide |
| **Delivery Depot** | Approved work, crated and logged |
| **Rest Point** | Where an agent waits between jobs |
| **Gate** | The way on and off the island |

---

## Screens

| Route | Screen |
| ----- | ------ |
| `/` | Visual workspace — all five islands, live |
| `/islands/:id` | One island, full size, with its agents and places |
| `/projects` | Project list |
| `/projects/:id` | Project details and its task board |
| `/tasks` | Task board across every project |
| `/bots` | The team |
| `/bots/:id` | Agent details: status, history, responsibilities, rules |
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
writing a second set of implementations and changing no callers.

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
| Create a project | **Projects → New project** |
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

1. A task is created. Its **kind of work** decides which island it happens on
   and which agent naturally owns it.
2. You assign it — to the natural owner, or to anyone. An agent given work on
   another island **travels there**.
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

- Seeded SQLite world with five islands, five agents and three projects
- Mock engine driving all seven agent states, ticking at 2 Hz
- Full command API: projects, tasks, assignment, execution and approvals
- Live updates over Server-Sent Events, with automatic reconnection
- All eight screens, rendering and mutating real data
- 58 server tests

Still to come:

- Real Claude agents behind the existing `AgentEngine` interface
- Authentication, and more than one world
- Retention on the activity log
