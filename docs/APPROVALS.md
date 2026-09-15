# Permissions and approvals

The rule this exists to make true: **an agent never takes an action with an
effect you did not agree to.** Not "is instructed not to" — cannot.

Everything with a consequence outside the work itself stops and waits for a
person. While it waits, the agent is genuinely stopped: no tokens, no tool
calls, nothing happening. Approving resumes it exactly where it stopped.

---

## What always needs your permission

| | Category | Covers |
| --- | --- | --- |
| ✉️ | **Send an email** | Mail leaving this system, to anyone |
| 💬 | **Message someone outside** | Any message to a person or service outside this workspace |
| 💳 | **Spend money** | Buying data, services or capacity |
| 🗑️ | **Delete files** | Removing or overwriting a file that already exists |
| ⚠️ | **Run a destructive command** | Anything that changes or removes what it cannot put back |
| 🚀 | **Deploy to production** | Shipping to a system real people are using |
| 🗃️ | **Change production data** | Writing to live records rather than a copy |
| 🔐 | **Use sensitive data** | Reading or moving confidential material |
| 🚫 | **Reach outside this project** | Touching anything belonging to another project |
| 🔑 | **An action you marked** | Anything this agent or task was configured to ask about |
| 📦 | **Deliver finished work** | Work that needs your sign-off before it goes out |

The list is in
[`packages/shared/src/permissions.ts`](../packages/shared/src/permissions.ts),
and it is a list of things no agent may do alone — not a menu of options.

## Three answers, and they are different

**Approve** — the action happens, and the run carries on.

**Reject** — the action does not happen. The agent is told, and carries on
*without* having done it. Refusing one action does not throw the task away.

**Cancel** — the request is withdrawn and the work is called off. Nobody
decided anything; the task stops. Recorded as `cancelled`, not `rejected`, so
the audit log can answer "what did you decide" separately from "what happened
to this work".

## What a request tells you

A request you have to go and investigate before you can answer is a request
that gets waved through, so everything needed to decide is on it:

- which agent is asking, its role, its project and its task
- **the action**, as an imperative
- **why** it wants to do it
- **the tools** it would use
- **what it touches** — files, records
- **what happens if this is wrong**, and whether it can be undone
- a risk level, and whether a run is stopped on the answer

They appear in three places, all the same component: the **approvals inbox**,
the **agent's own page**, and the **task card** wherever it is shown. Every
request and every decision is also written to the **activity log**.

---

## The security model

Approval is the last of several layers, not the only one.

**Project access.** An agent may only act on the project it is on. Enforced
when a run starts and again on every action, from the rows themselves rather
than from anything the model says.

**Tool permissions.** Each agent carries its own allow-list. A tool not on it
is never offered to the model, and a tool on the forbidden list — shell, code
execution, filesystem editors — belongs to no agent in this build. Those are
`deny`, not `approve`: an agent with no shell cannot be given one by clicking a
button, and offering that button would be a lie about what the system can do.

**Task scope.** A run is handed exactly one agent, one task and one project.
There is no way to reach a second one even if the model asks.

**Approval gates.** The categories above. `PermissionService.check()` returns
`allow`, `deny` or `approve`, and the run's only route to a gated action is
`requestApproval()`, which blocks until you answer.

**Limits.** Wall-clock time, output tokens and searches, per agent. The clock
is **paused** while a run waits at a gate — time you spend reading a request is
not time the agent spent working.

**Audit log.** Every request, decision, refusal and withdrawal is an activity
event with its reason attached, visible per project, per agent and per task.

**Cancellation.** A run stopped at a gate can still be cancelled — from the
request, from the task, or on shutdown.

**API keys.** Read from the environment by the SDK. Never stored, never logged,
never returned by an endpoint, never in a prompt or an approval request.

## When a run does not survive

A gate is a promise held in memory, so a restart ends it. On boot, any request
still pending-and-blocking is withdrawn and its task is marked failed with a
blocker that says what happened — *nothing was done without your approval* —
and **Retry** runs it again. Nothing is lost: the task, its history and its
results are all still there.

Deciding a stale request is refused rather than guessed at: approving one whose
run is gone would otherwise "deliver" work that was never finished.

---

## For whoever writes the next agent

A runner asks like this:

```ts
const answer = await context.requestApproval({
  category: 'send_email',
  action: 'Email the IC pack to the client',
  reason: 'The committee asked for it before Friday.',
  tools: ['PowerPoint export'],
  impact: 'The pack leaves this system. An email cannot be unsent.',
  files: ['ic-pack-v3.pptx'],
});

if (answer !== 'approved') {
  // Carry on without having done it, and say so in the result.
}
```

It resolves with the decision rather than throwing, because being refused is a
normal thing that happens to an agent — the run is expected to handle it, not
crash.

## Tests

```bash
npm test
```

The approval suite covers the three answers and the cases that matter most:
that a gated action does not happen while a request is unanswered, does not
happen after a refusal, and does not happen after a cancellation; that
approving resumes the run and it then does happen; that a run cannot answer its
own request; that each category is gated; that denied tools are refused rather
than asked about; and that a restart leaves nothing stranded.

Eight of them fail if the gate stops actually blocking — which is the property
worth protecting.
