# Real agents

Nova the Researcher is backed by a real Claude model. This page is how to
configure it, how to run it, and what it is and is not allowed to do.

Everything else in the world is still the mock engine, and the island shows
which is which. A live run drives the same states the mock does — so the board,
the approval queue and the activity log work identically — but nothing invents
progress on a real agent's behalf, and the world never says "working" unless the
backend says so.

---

## 1. Configure the API key

The key is read from the environment and nothing else. It is never written to
the database, never sent to the browser, never logged, and never put into a
prompt or an activity line.

```bash
cp .env.example .env
```

Then edit `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Get a key from <https://console.anthropic.com/settings/keys>. `.env` is
gitignored; `.env.example` holds the placeholder and must stay empty.

With no key set the app runs exactly as before on the mock engine, and asking
to run a real agent answers "no ANTHROPIC_API_KEY is configured" rather than
failing somewhere inside the SDK.

### Related settings

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `ANTHROPIC_API_KEY` | *(unset)* | Your key. Required for a live run. |
| `AGENT_MODEL` | `claude-opus-5` | The model a newly hired agent runs on. Each agent stores its own, so this is only the default. |
| `AGENT_MAX_SEARCHES` | `8` | How many web searches one run may perform. |

---

## 2. Run the agent locally

### The test task

One command creates a research task and runs it end to end:

```bash
npm run agent:nova
```

It prints the project, the agent, the limits and the tools; then the searches
as they happen; then the finished report, what the run cost, and where the work
ended up. A different question:

```bash
npm run agent:nova -- "Research open-source alternatives to Airtable"
```

To check the wiring without spending anything:

```bash
npm run agent:nova -- --dry-run
```

`Ctrl-C` cancels a run in flight, the same way the stop endpoint does.

Runs write to the configured database, so afterwards the task, its result and
its history are all visible in the app.

### From the API

```bash
# Is a live agent available at all?
curl localhost:4000/api/runtime

# Start a run. Answers 202 immediately; progress arrives on the event stream.
curl -X POST localhost:4000/api/tasks/<taskId>/run

# Stop one that is running.
curl -X POST localhost:4000/api/tasks/<taskId>/stop

# Everything the task has produced, newest first.
curl localhost:4000/api/tasks/<taskId>/results
```

`/api/runtime` reports **whether** a key is configured. It never reports the key.

---

## 3. What a run does

`TaskExecutionService.execute(taskId)` is the whole flow:

1. **Load** the task, its agent and its project, and refuse early if anything
   is wrong — no agent assigned, the task already running or finished, an
   archetype with no live engine, or an agent that is not on this project.
2. **Resolve the tools** from the agent's stored brief, refusing outright on
   anything forbidden.
3. **Mark it working**, write the activity line, and publish the change.
4. **Run the agent** with an abort signal and a deadline.
5. **Save the result** — the report, the prose, the stop reason, the token and
   search counts, and how long it took.
6. **Leave the task in a defensible state**: waiting for approval, delivering,
   failed with a readable blocker, or cancelled.

### The states

The eight states in the brief, and what puts an agent in each:

| State | Meaning |
| ----- | ------- |
| **Idle** | Nothing assigned, or a run was cancelled |
| **Queued** | Accepted, not yet started |
| **Working** | The model is running |
| **Waiting for approval** | Finished; needs your sign-off before delivery |
| **Completed** | Approved and delivered |
| **Paused** | Held by you, progress kept |
| **Failed** | An error, a refusal, or a run that passed its limit |
| **Cancelled** | Stopped on purpose |

### The research run itself

Nova works in two phases, and the order is deliberate:

1. **Research.** Streams with web search enabled, resuming a `pause_turn` by
   pushing the paused turn back, and recording every URL actually retrieved.
2. **Structure.** A second call turns the prose into a typed `ResearchReport`
   — summary, findings tagged fact or assumption, sources, open questions and
   a confidence.

Separating them means the structuring call cannot be the thing that invents a
source: by the time it runs, every retrieval has already happened.

Afterwards the report's sources are compared against what was actually
retrieved. A cited URL that was never fetched becomes a warning on the task's
history rather than a silent claim — this is how *"do not claim to have
researched something unless you actually did it"* is checked instead of
trusted.

---

## 4. What the island shows

The visual world represents the backend's actual state. Nothing on screen is a
guess, and the one rule everything else follows is: **the world never shows an
agent working unless the backend says it is working.**

### Who does what

The simulation and the real runtime share the island, and the split is clean:

| | Simulated task | Live task |
| --- | --- | --- |
| Walking between buildings | mock engine | **mock engine** |
| Progress | mock engine, from a clock | **the run, from what it reported** |
| Finishing, approvals, delivery | mock engine | **the run, then your decision** |

Locomotion is presentation, and it is the same either way — so a live agent
still walks to the Research Library, still carries work to Headquarters, still
hauls the crate to the Delivery Depot. What the simulation never touches is a
number a model is responsible for: while a run is in flight, the engine will not
advance its progress and cannot finish the task behind the model's back.

### What you see, step by step

**When a run starts.** The task becomes `queued` and the agent sets off for the
building the work happens at. The moment the model call actually begins, both
become `working` — not before. The bot carries a plate with the task title, the
progress panel starts, and the activity log records the start.

**While it runs.** Progress moves when the run reports something real: it
started, it made a search, it is writing up. It is not a guess at elapsed time —
nothing can know how much of a research run is left — so the bar is labelled
*milestones reached* rather than pretending to be a percentage of the work. Each
search is written into the activity log as it happens.

**When it finishes.** The result is stored, the task goes to Waiting for
Approval, and the agent walks to Headquarters carrying the work. The report
appears on the task with its findings, sources and open questions, and
**Approve** / **Send back** sit underneath it. Approving sends the agent to the
depot; arriving there is what completes the task.

**When it fails.** The task shows Failed with the reason in plain words — *"The
API rejected the credentials"*, not a stack trace. The bot stays where it was,
still assigned, and **Run again** re-runs it. Nothing is lost: the task, its
history and every search it made before it broke are all still there.

**When it is stopped.** Cancel aborts the run mid-flight; the task is cancelled
and the agent is freed. Pause is not offered for a live run, because a model call
cannot be suspended and picked up later — the server refuses it rather than
pretending.

### Telling the two apart

Every task records how its progress is being produced, so the interface can say
which it is showing you — and still say it after a reload:

- a **live agent** badge on the task, and a violet marker on the bot's plate
- the progress bar says *live run* or *simulated progress*
- the top bar counts live runs while any are going
- **Run for real** and **Simulate** are separate buttons, because one calls a
  model and the other does not, and a single button that might do either would
  be a trap

Simulated demo mode is unchanged and always available: with no API key
configured, everything works exactly as it did before.

### The event contract

The server pushes two kinds of message. Rows (`tick`, `approvals`, `projects`,
`activity`) are **what is now true** — the client renders those. Named events
(`events`) are **what happened**, which is what you need in order to react:

| Event | Means | Carries |
| ----- | ----- | ------- |
| `agent.status` | an agent changed state | `from`, `to`, `taskId` |
| `task.created` | a task was added | `projectId`, `title` |
| `task.started` | work actually began | `agentId`, `runMode` |
| `task.progress` | progress moved a whole point | `progress`, `runMode` |
| `task.completed` | delivered | `agentId`, `runMode` |
| `task.failed` | stopped, with a reason | `agentId`, `reason` |
| `approval.requested` | needs your decision | `taskId`, `summary` |
| `approval.resolved` | you decided | `decision` |

They are **derived from the rows that changed**, in one place on the server
(`realtime/domain-events.ts`), rather than emitted by each transition. That
means an event can never disagree with the row it describes, cannot be forgotten
at a call site, and does not care whether the simulation or a real agent caused
it. `DOMAIN_EVENT_KINDS` in the shared package is the list, with a compile-time
check that nothing is missing from it.

---

## 5. What an agent may not do

The security rules are enforced in code before a run starts, not left to the
model's judgement.

| Rule | How it is enforced |
| ---- | ------------------ |
| No destructive commands | The only tool ever offered is Anthropic-hosted `web_search`. There is no shell, no filesystem and no code execution anywhere in the runtime. |
| No deleting files | Same: no tool can reach this machine. |
| No sending email, no spending money | No such tool exists, and a brief that names one is refused before the run starts. |
| No reaching other projects | The executor loads exactly one project and one task, and refuses if the agent is not on that project. |
| No exposing API keys | The key is read from the environment by the SDK. It is never stored, logged, returned by an endpoint or put into a prompt. |
| No unapproved external changes | Web search is read-only, and finished research comes back for approval by default. |

`FORBIDDEN_TOOLS` in
[`nova.ts`](../packages/server/src/services/agents/claude/nova.ts) lists what is
banned outright, normalised so `Code Execution` and `code_execution` are the
same refusal. Adding to the allow-list is a code change with a review attached,
not a config edit.

### Limits

Every run has a ceiling, stored per agent and editable on its page:

| Limit | Default |
| ----- | ------- |
| Wall-clock time | 180s — the run is aborted, not left to finish |
| Output tokens | 16,000 |
| Web searches | 8 |
| Approval | Required |

---

## 6. Tests

```bash
npm test
```

No test reaches the network. The Anthropic client is replaced by a fake that
encodes the real response shapes — a search result is a list on success and an
object on error, usage is snake_case, a refusal arrives as HTTP 200 — because a
fake that gets those wrong would make the tests agree with a bug.

The suite covers the honesty check, `pause_turn` resumption, refusals, the time
limit, cancellation, the forbidden-tool guard, project-scope enforcement, and
usage being recorded.

The integration itself is tested the same way, with the simulation and a real
run driving the world at once: that the agent still walks to its building, that
the simulation never invents progress for a live task, that a finished run sends
the agent to Headquarters and an approved one to the depot, that a failure keeps
the bot, the task and the logs, and that every transition produces the event a
browser would need.

---

## 7. What is not wired up yet

- Only the Researcher has a live engine. Running any other archetype for real is
  refused rather than silently simulated.
- There is no cost ceiling in currency. A run is bounded by time, output tokens
  and searches, which are the levers actually available.
- Auto-assignment is the simulation's, not a real project manager's: an idle
  agent picking work off the board never starts a live run by itself. A live run
  is always something you asked for.
