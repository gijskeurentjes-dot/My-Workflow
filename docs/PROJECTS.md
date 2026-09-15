# Projects and tasks

The task system works on its own. Every board move, dependency and milestone is
a service call with its own rules, and the island is a *view* of what those
rules produced — turn the world off and the work still holds together.

---

## A project

Each island carries the same things:

| | |
| --- | --- |
| **Name, description** | What it is |
| **Goals** | What done looks like, one per line — what the project is judged against |
| **Repository** | Where the code lives, if it lives anywhere |
| **AI team** | Its own agents; a deal room's five are fixed |
| **Tasks** | The board, filtered to this project |
| **Milestones** | What it is working towards, with the work counted up |
| **Project files** | What it has, and what its agents produced |
| **Activity log** | Everything that happened, with reasons |
| **Settings** | Name, description, goals, repository, colour; delete |

**Files are references, not copies.** A name, a kind and where it lives. This
build has no storage of its own, and saying where something is beats pretending
to hold it. A file linked to a task is that task's **deliverable**.

## The board

Seven lanes, and all seven are always drawn — a board whose columns come and go
with their contents is one you cannot learn the shape of, and an empty lane is
information.

| Lane | What is in it |
| ---- | ------------- |
| **Backlog** | Captured, not scheduled |
| **To do** | Ready to start |
| **In progress** | Queued, working, delivering, paused — an agent is on it |
| **Waiting for approval** | Stopped until you decide |
| **Review** | Finished, being checked |
| **Completed** | Delivered |
| **Failed** | Blocked, or called off |

Several statuses share a lane, and that mapping lives in
[`status.ts`](../packages/shared/src/status.ts) with a compile-time check that
every status has one — so adding a state to the machine forces a decision about
where it appears rather than letting it vanish.

**You move work through three of those lanes; the rest are the state machine's.**
Backlog, To do and Review are yours — the others are set by what is actually
happening, and letting a drag set them would make the board and the world
disagree about reality.

### A task

Title, description, assigned agent, priority, status, progress, dependencies,
subtasks, deliverables, milestone, created and updated. Plus the things earlier
milestones added: whether its progress is live or simulated, its blocker, and
whether it needs approval.

**Create, edit, assign, reassign, start, pause, stop, retry, view results, view
activity** were already there. This milestone adds **subtasks**,
**dependencies**, **move**, **sign off**, **milestones** and **files**.

## Dependencies

A dependency is a promise about order, so it is enforced rather than displayed:

- starting a task whose dependencies are unmet is **refused** — by the board, by
  the simulation's pickup, and by the live runtime alike
- an idle agent will not pick up blocked work however urgent it is
- a **cancelled** dependency still blocks: somebody decided that work was not
  happening, and the thing that needed it should not quietly proceed
- a cycle is refused, because a cycle is a deadlock with extra steps

The card says what it is waiting for, and the Start button is disabled with the
reason in its tooltip.

## Subtasks

One level deep, on purpose: a subtask cannot have subtasks. Deep trees are where
task managers go to become unreadable, and nothing here needs one. On the board a
subtask sits under its parent rather than floating as a peer.

## Milestones

A milestone turns "nine tasks open" into "two tasks from done". Each one counts
the tasks pointed at it, shows a bar, and says when it is due — and when it is
overdue. Deleting one leaves its tasks alone: the work is still real, it just
stops counting towards anything.

---

## What the island shows

The world follows the work, never the other way round:

| The work | The island |
| --- | --- |
| **Backlog / To do** | Nothing walking — it is on the board, not on the island |
| **In progress** | The agent walks to the building its kind of work happens at |
| **Waiting for approval** | The agent carries it to Headquarters and waits |
| **Review** | The agent waits at the Meeting Circle with it |
| **Completed** | The agent hauls it to the Delivery Depot; arriving is what completes it |

The rule from the runtime milestone still holds underneath all of this: the
world never shows an agent working unless the backend reports that it is.

## Knowing how a project is doing

Every island reports its **health** — and the reason, not just the word:

> **Blocked** — 1 task stopped and waiting on a decision from you.

In order of urgency: *Blocked* (something failed), *Needs you* (finished work
waiting for sign-off), *Behind* (a milestone past its due date), *Moving*
(work under way), *Idle* (open tasks, nobody on them), *All done*, *Empty*.
"Blocked" on its own leaves you to go and find out what is blocked; the reason
answers the follow-up before it is asked.

The workspace also lists **recent deliverables** across every project — the
answer to "so what came out of all this?", which no other screen gives in one
place.

## What live runs cost

`GET /api/usage` totals what real runs have spent: runs, tokens, searches and
model time, by agent and by project. It appears on **Settings** for the whole
world and on each **agent's page** for that agent.

Only live runs are counted. The simulation costs nothing and appears nowhere in
these numbers — a figure that quietly mixed the two would be worse than none.
Before anything has run for real it says so, rather than showing a row of
confident zeroes: a zero reads as a measurement, and "nothing has happened yet"
is not one.

## Tests

```bash
npm test
```

The project-management suite asserts all of it through the services rather than
the screens, because the brief asks for a task system that is useful with the
visual world switched off. The world is checked separately, at the end — that an
agent walks to the Meeting Circle when its work goes into review, and that
moving work back to the board frees whoever was holding it.
