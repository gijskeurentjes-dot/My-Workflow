# AI Islands

A visual workspace for a team of AI agents. Five agents live on five islands; you
can see at a glance which projects exist, who is working, what they are doing,
what is waiting, what is finished, and where you need to make a decision.

> **One agent is real; the rest are simulated.** Nova the Researcher runs on a
> real Claude model — see [docs/AGENTS.md](docs/AGENTS.md). Everyone else is
> driven by a mock engine: progress, walking, approvals and deliveries come from
> a state machine. The *states*, the *transitions* and the *events* are the same
> either way, which is why a live run needs no screen of its own.

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
| `npm run agent:nova`| Run the real research agent on a test task ([docs](docs/AGENTS.md)) |

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

## Real agents

**Nova the Researcher is real.** Give her a task like *"Research the top
competitors in my market and create a summary"* and she runs on Claude with web
search, produces a structured report — findings tagged fact or assumption,
sources, open questions, a confidence — and comes back for your approval.

```bash
npm run agent:nova
```

Two things are worth knowing:

- **The honesty check is code, not a promise.** Her brief says *"do not claim to
  have researched something unless you actually did it"*, so after every run the
  report's sources are compared against the URLs actually retrieved. A cited
  page that was never fetched becomes a warning on the task's history.
- **The security rules are enforced before the run starts.** The only tool ever
  offered is Anthropic-hosted web search — no shell, no filesystem, no code
  execution, nothing that can send mail or spend money — and an agent may only
  run work belonging to the project it is on.

**The island shows what the backend is actually doing.** Press **Run for real**
on a task and the agent walks to the Research Library, works while the model
works, carries the finished report to Headquarters and waits for your decision;
approve it and the crate goes to the depot. If the run fails you get the reason
in plain words, the bot stays put, and **Run again** re-runs it.

The rule underneath all of it: **the world never shows an agent working unless
the backend reports that it is working.** A task records whether its progress is
`live` or `simulated`, so the interface can say which it is showing you — and
the simulation will not advance a number a model is responsible for. **Run for
real** and **Simulate** are separate buttons, and with no API key configured
everything works exactly as it did before.

Setup, the event contract, limits, and what an agent may not do:
**[docs/AGENTS.md](docs/AGENTS.md)**.

---

## The M&A Deal Room

A **deal room** is a project with a fixed team of five named specialists —
**Atlas** (project manager), **Nova** (researcher), **Forge** (developer),
**Ledger** (financial modelling) and **Canvas** (presentations) — each working
under explicit permissions, hard restrictions and approval gates that are shown
on its own page.

Create one from **Projects → New project → M&A Deal Room**. It gets its own
island, board, approvals and history like any other project; what is different
is that the team cannot change. Nobody else can be hired onto it, none of the
five can be dismissed, and no agent can create an agent — there is no such code
path, in this or any other project.

Full detail, including what is enforced in code versus stated in a brief, and
what the later phases add: **[docs/DEAL-ROOM.md](docs/DEAL-ROOM.md)**.

---

## Permissions and approvals

**An agent never takes an action with an effect you did not agree to.** Sending,
spending, deleting, deploying, touching production or another project's files —
each one stops and waits for a person, and while it waits the agent is genuinely
stopped: no tokens, no tool calls. Approving resumes it exactly where it
stopped; refusing means it carries on *without* having done it; cancelling calls
the work off.

Every request carries what you need in order to answer — the action, why, which
tools, what it touches, what happens if it is wrong — and appears in the
approvals inbox, on the agent's own page, and on the task card, with every
decision written to the activity log.

The categories, the security model behind them, and what happens to a request
whose run did not survive a restart: **[docs/APPROVALS.md](docs/APPROVALS.md)**.

---

## Managing the work

Every project carries its **goals**, its **repository**, its **team**, its
**milestones**, its **files** and its **activity** — and the board runs in seven
lanes: Backlog, To do, In progress, Waiting for approval, Review, Completed,
Failed.

Tasks break into **subtasks**, wait on each other through **dependencies**, and
count towards **milestones**. A dependency is enforced rather than displayed:
work that is waiting on something else will not start, and an idle agent will not
pick it up however urgent it is.

**The task system works without the visual world.** The island is a view of what
the rules produced — in progress walks an agent to a building, review sends it to
the Meeting Circle, completed sends it to the depot — but every rule lives in a
service, with its own tests.

Full detail: **[docs/PROJECTS.md](docs/PROJECTS.md)**.

---

## Replacing the rest of the mock agents

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
| `ANTHROPIC_API_KEY` | *(unset)* | Needed to run a real agent. Without it the app runs on the mock engine as before |
| `AGENT_MODEL` | `claude-opus-5` | The model a newly hired agent runs on |
| `AGENT_MAX_SEARCHES` | `8` | How many web searches one research run may perform |

Secrets belong in `.env`, which is gitignored — never in `.env.example`. The
API key is read from the environment by the SDK: it is never stored in the
database, returned by an endpoint, logged, or put into a prompt. Full setup in
[docs/AGENTS.md](docs/AGENTS.md).

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

The world runs, you can drive it, and one agent is real.

- Multiple projects, each its own island with its own team
- Multiple agents per project, hired and dismissed at will
- Per-agent role, instructions and tools, stored and editable
- Task priority, which orders the board and decides what is picked up first
- Mock engine driving all seven agent states, ticking at 2 Hz
- Full command API: projects, agents, tasks, execution and approvals
- Live updates over Server-Sent Events, with automatic reconnection
- Every screen rendering and mutating real data
- **A real research agent**: Claude with web search, structured reports, an
  honesty check on its sources, enforced tool and project limits, cancellation
  and recorded usage
- **The visual world driven by the real backend**: live runs walk the island,
  show their report, and are never confused with simulated ones
- A named event contract for status, progress, completion, failure and approvals
- 137 server tests, none of which touch the network

Still to come:

- Live engines for the other four archetypes
- Authentication, and more than one world
- Retention on the activity log
