# Real agents

Nova the Researcher is backed by a real Claude model. This page is how to
configure it, how to run it, and what it is and is not allowed to do.

Everything else in the world is still the mock engine. A live run drives the
same states the mock does, so nothing downstream — the board, the approval
queue, the activity log — can tell the two apart.

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

## 4. What an agent may not do

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

## 5. Tests

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

---

## 6. What is not wired up yet

The live runtime is deliberately **not** connected to the visual world. There
is no "run for real" button, and the engine that walks agents around the island
is still the mock. Execution is reachable from the command line and the API so
that the backend can be proven on its own first.
