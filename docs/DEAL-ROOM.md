# The M&A Deal Room

A deal room is a project with a **fixed team of five named specialists**, each
working under explicit permissions. It exists because M&A work has a property
ordinary project work does not: every output has to be traceable to who produced
it, under what authority, from which sources — and "the team is whoever turned
up" is the wrong answer to all of those.

Create one from **Projects → New project → M&A Deal Room**, or:

```bash
curl -X POST localhost:4000/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"template":"deal_room","name":"Project Helix"}'
```

It appears as its own island, with its own team, board, approvals and history,
alongside every other project.

---

## The five

| Agent | Role | Works from |
| ----- | ---- | ---------- |
| **Atlas** | M&A Project Manager | Headquarters |
| **Nova** | M&A Researcher | Research Library |
| **Forge** | Developer and Automation Engineer | Workshop |
| **Ledger** | Financial Modeling and Excel Specialist | Data Workshop |
| **Canvas** | PowerPoint and Deal Presentation Specialist | Presentation Studio |

They are a **registry**, not a factory:
[`packages/shared/src/deal-room.ts`](../packages/shared/src/deal-room.ts) is the
whole list, and there is no code path that produces a sixth. Hiring onto a deal
room is refused; dismissing one of the five is refused. No agent can create an
agent — that capability does not exist anywhere in the build, and the rule is
also written into every brief, so a model cannot be talked into believing it has
one.

Each agent reuses an existing archetype (`pm`, `researcher`, `developer`,
`analyst`, `presenter`), which is what gives it its look, its home building and
the kind of task it naturally owns. What the registry adds is the part that is
specific to a deal room: the role, the permissions, and the limits.

## Permissions, and where they actually live

Every definition carries three lists:

- **`permissions`** — what this agent may do
- **`restrictedActions`** — what it may never do, however it is asked
- **`approvalRequiredFor`** — what it must stop and ask a person about

They are visible on the agent's own page, and they are assembled into the brief
a live engine sends as that agent's system prompt.

**A prompt is a statement of intent; the server is where intent is made true.**
So the rules that can be enforced in code are enforced in code — the fixed team,
project scope, the tool allow-list, the approval gate before delivery. The rest
are stated in the brief and will move into the services as the features they
govern are built. Where a rule is only in the brief today, this document says so.

## The nine phases

Deal Setup · Information Collection · Commercial Due Diligence · Financial Due
Diligence · Valuation · Deal Structuring · Investment Committee Preparation ·
Review and Approval · Final Deliverables.

They are listed on the project page. Tasks get a `phase` field in the next
milestone; today they are the shared vocabulary the team works in.

---

## What is built today (Phase 1)

- The fixed five-agent registry, with permissions, restrictions, approval gates
  and output standards for each
- The deal-room project template: creating one hires exactly those five, each
  with its own role, brief and tool list, at its own building
- Hiring onto a deal room and dismissing from it are both refused by the server
- The charter is shown on each agent's page; the phases on the project page
- 17 tests covering the registry, the fixed team, project scope, and that the
  existing Researcher still works exactly as before

## What is not built yet

Later phases, in the order they are planned:

- **Task delegation** — `phase`, `dependencies`, `createdBy`, and input/output
  files on a task; Atlas creating and assigning subtasks
- **The approval queue** — approval requests carrying the proposed action, the
  reason, the files affected and a risk level, with request-changes alongside
  approve and reject
- **Specialist workflows** — Ledger producing real workbooks, Canvas real decks,
  Forge real code changes. Today only the Researcher has a live engine; asking
  to run any other agent for real is refused rather than silently simulated
- **The deal-room island areas** — Document Vault, Approval Desk and Deal
  Timeline as places on the island, and idle agents standing at their own
  stations rather than gathering at the Meeting Circle

Until a specialist has a live engine, its work is simulated — and the interface
says so, on every task, exactly as it does everywhere else.
