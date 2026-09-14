import { afterEach, describe, expect, it } from 'vitest';
import { TASK_TYPES } from '@ai-islands/shared';
import { WorkflowError } from '../errors.js';
import { botByName, createTestWorld, taskByTitle, type TestWorld } from '../test/helpers.js';

describe('projects', () => {
  let w: TestWorld;
  afterEach(() => w?.close());

  it('creates a project', () => {
    w = createTestWorld();
    const { project } = w.workflow.createProject({ name: 'Website refresh', goal: 'Ship by March' });

    expect(project.name).toBe('Website refresh');
    expect(project.status).toBe('active');
    expect(w.repos.projects.findById(project.id)).not.toBeNull();
  });

  it('refuses a project with no name', () => {
    w = createTestWorld();
    expect(() => w.workflow.createProject({ name: '   ' })).toThrow(WorkflowError);
  });

  it('renames a project', () => {
    w = createTestWorld();
    const original = w.repos.projects.list()[0]!;
    const { project } = w.workflow.updateProject(original.id, { name: 'Renamed' });
    expect(project.name).toBe('Renamed');
  });

  it('releases agents when a project is deleted', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Break the launch into workstreams');
    const botId = task.botId!;

    w.workflow.deleteProject(task.projectId);

    // The task is gone, and the agent is not left thinking it still has work.
    expect(w.repos.tasks.findById(task.id)).toBeNull();
    const bot = w.repos.bots.findById(botId)!;
    expect(bot.taskId).toBeNull();
    expect(bot.status).toBe('idle');
  });
});

describe('tasks', () => {
  let w: TestWorld;
  afterEach(() => w?.close());

  it('routes a new task to the island its kind of work belongs to', () => {
    w = createTestWorld();
    const project = w.repos.projects.list()[0]!;

    const { task } = w.workflow.createTask({
      projectId: project.id,
      title: 'Rebuild the pricing model',
      type: 'analysis',
    });

    const island = w.repos.islands.findById(task.islandId)!;
    expect(island.key).toBe(TASK_TYPES.analysis.island);
    expect(task.status).toBe('backlog');
  });

  it('can create, assign and start in one step', () => {
    w = createTestWorld();
    const project = w.repos.projects.list()[0]!;
    const forge = botByName(w.repos, 'Forge');
    // Free Forge from the seeded blocked task first.
    w.workflow.cancelTask(taskByTitle(w.repos, 'Fix the checkout regression').id);

    const { task } = w.workflow.createTask({
      projectId: project.id,
      title: 'Add the annual toggle',
      type: 'coding',
      botId: forge.id,
      autoStart: true,
    });

    expect(task.status).toBe('working');
    expect(task.botId).toBe(forge.id);
    expect(w.repos.bots.findById(forge.id)!.status).toBe('working');
  });

  it('refuses a task with no title', () => {
    w = createTestWorld();
    const project = w.repos.projects.list()[0]!;
    expect(() =>
      w.workflow.createTask({ projectId: project.id, title: '  ', type: 'planning' }),
    ).toThrow(WorkflowError);
  });

  it('marks a task as requiring approval', () => {
    w = createTestWorld();
    const project = w.repos.projects.list()[0]!;
    const { task } = w.workflow.createTask({
      projectId: project.id,
      title: 'Quick note',
      type: 'planning',
      needsApproval: false,
    });
    expect(task.needsApproval).toBe(false);

    const { task: updated } = w.workflow.updateTask(task.id, { needsApproval: true });
    expect(updated.needsApproval).toBe(true);
  });

  it('refuses to change the approval setting of work already waiting on you', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Competitor landscape scan');
    expect(task.status).toBe('waiting_approval');

    expect(() => w.workflow.updateTask(task.id, { needsApproval: false })).toThrow(
      /already finished and waiting on you/i,
    );
  });
});

describe('running work', () => {
  let w: TestWorld;
  afterEach(() => w?.close());

  it('assigns waiting work and starts it', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Build the new pricing page');
    const forge = botByName(w.repos, 'Forge');
    w.workflow.cancelTask(taskByTitle(w.repos, 'Fix the checkout regression').id);

    w.workflow.assignTask(task.id, forge.id);
    w.workflow.startTask(task.id);

    const started = w.repos.tasks.findById(task.id)!;
    expect(started.status).toBe('working');
    expect(started.startedAt).not.toBeNull();
    expect(w.repos.bots.findById(forge.id)!.taskId).toBe(task.id);
  });

  it('starting unassigned work hands it to the agent that owns that kind of task', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Summarise the customer interviews');
    expect(task.botId).toBeNull();
    // Free Nova, who owns research.
    w.workflow.cancelTask(taskByTitle(w.repos, 'Competitor landscape scan').id);

    w.workflow.startTask(task.id);

    const started = w.repos.tasks.findById(task.id)!;
    expect(started.botId).toBe(botByName(w.repos, 'Nova').id);
    expect(started.status).toBe('working');
  });

  it('sends an agent to another island when the work is there', () => {
    w = createTestWorld();
    const atlas = botByName(w.repos, 'Atlas');
    const homeIsland = atlas.islandId;
    const task = taskByTitle(w.repos, 'Build the new pricing page'); // coding → Workshop

    w.workflow.assignTask(task.id, atlas.id);

    const travelled = w.repos.bots.findById(atlas.id)!;
    expect(travelled.islandId).toBe(task.islandId);
    expect(travelled.islandId).not.toBe(homeIsland);
    // It arrives at the gate and walks in, rather than appearing at the desk.
    expect(travelled.locationKey).toBe('gate');
  });

  it('reassigning frees the previous agent', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Break the launch into workstreams');
    const atlas = w.repos.bots.findById(task.botId!)!;
    const nova = botByName(w.repos, 'Nova');

    w.workflow.assignTask(task.id, nova.id);

    expect(w.repos.bots.findById(atlas.id)!.taskId).toBeNull();
    expect(w.repos.tasks.findById(task.id)!.botId).toBe(nova.id);
  });

  it('pausing freezes progress and the agent stops walking', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Break the launch into workstreams');

    w.workflow.pauseTask(task.id);
    const at = w.repos.tasks.findById(task.id)!.progress;
    w.fastForward(60);

    const after = w.repos.tasks.findById(task.id)!;
    expect(after.status).toBe('paused');
    expect(after.progress).toBe(at);

    const bot = w.repos.bots.findById(task.botId!)!;
    expect(bot.status).toBe('paused');
    expect(bot.movement).toBeNull();
  });

  it('resuming a paused task continues from where it stopped', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Launch deck: storyline and slides');
    const at = task.progress;

    w.workflow.startTask(task.id);
    w.fastForward(20);

    const after = w.repos.tasks.findById(task.id)!;
    expect(after.status).toBe('working');
    expect(after.progress).toBeGreaterThan(at);
  });

  it('refuses to pause something that is not running', () => {
    w = createTestWorld();
    const backlog = taskByTitle(w.repos, 'Build the new pricing page');
    expect(() => w.workflow.pauseTask(backlog.id)).toThrow(/only work in progress/i);
  });

  it('cancelling keeps the progress for the record and frees the agent', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Break the launch into workstreams');
    const botId = task.botId!;
    const progress = task.progress;

    w.workflow.cancelTask(task.id);

    const cancelled = w.repos.tasks.findById(task.id)!;
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.progress).toBe(progress);
    expect(cancelled.botId).toBeNull();

    const bot = w.repos.bots.findById(botId)!;
    expect(bot.taskId).toBeNull();
    expect(bot.status).toBe('idle');
  });

  it('cancelling withdraws a pending approval request', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Competitor landscape scan');
    expect(w.repos.approvals.findPendingByTask(task.id)).not.toBeNull();

    w.workflow.cancelTask(task.id);

    // Nobody should be asked to decide on work that is no longer going anywhere.
    expect(w.repos.approvals.findPendingByTask(task.id)).toBeNull();
  });

  it('a cancelled task can be reset back onto the board', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Break the launch into workstreams');
    w.workflow.cancelTask(task.id);
    w.workflow.resetTask(task.id);

    const reset = w.repos.tasks.findById(task.id)!;
    expect(reset.status).toBe('backlog');
    expect(reset.progress).toBe(0);
    expect(reset.completedAt).toBeNull();
  });

  it('retry clears a blocker and puts the agent back to work', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Fix the checkout regression');
    expect(task.blocker).toBeTruthy();

    w.workflow.retryTask(task.id);

    const retried = w.repos.tasks.findById(task.id)!;
    expect(retried.status).toBe('working');
    expect(retried.blocker).toBeNull();
    expect(w.repos.bots.findById(task.botId!)!.status).toBe('working');

    // And it actually progresses again.
    w.fastForward(15);
    expect(w.repos.tasks.findById(task.id)!.progress).toBeGreaterThan(task.progress);
  });

  it('refuses to start blocked work — it has to be retried', () => {
    w = createTestWorld();
    const blocked = taskByTitle(w.repos, 'Fix the checkout regression');
    expect(() => w.workflow.startTask(blocked.id)).toThrow(/retry/i);
  });

  it('refuses to start work that is already running', () => {
    w = createTestWorld();
    const running = taskByTitle(w.repos, 'Break the launch into workstreams');
    expect(() => w.workflow.startTask(running.id)).toThrow(/already running/i);
  });
});

describe('the approval flow', () => {
  let w: TestWorld;
  afterEach(() => w?.close());

  const pendingFor = (w: TestWorld, title: string) => {
    const task = taskByTitle(w.repos, title);
    const approval = w.repos.approvals.findPendingByTask(task.id);
    if (!approval) throw new Error(`No pending approval for "${title}"`);
    return { task, approval };
  };

  it('approving sends the work to the depot and completes it there', () => {
    w = createTestWorld();
    const { task, approval } = pendingFor(w, 'Competitor landscape scan');
    const crates = w.repos.islands.findById(task.islandId)!.crates;

    w.workflow.approve(approval.id);

    // Approving does not complete the task by itself — the agent has to walk.
    expect(w.repos.tasks.findById(task.id)!.status).toBe('delivering');
    expect(w.repos.approvals.findById(approval.id)!.status).toBe('approved');

    const arrived = w.fastForwardUntil(
      () => w.repos.tasks.findById(task.id)!.status === 'completed',
      120,
    );
    expect(arrived, 'the delivery never completed').toBe(true);

    expect(w.repos.tasks.findById(task.id)!.completedAt).not.toBeNull();
    expect(w.repos.islands.findById(task.islandId)!.crates).toBe(crates + 1);
    expect(w.repos.bots.findById(approval.botId)!.taskId).toBeNull();
  });

  it('rejecting reopens the work and the agent carries on', () => {
    w = createTestWorld();
    const { task, approval } = pendingFor(w, 'Competitor landscape scan');

    w.workflow.reject(approval.id, 'Add the enterprise tier');

    const reopened = w.repos.tasks.findById(task.id)!;
    expect(reopened.status).toBe('working');
    // Knocked back, so there is real work to redo rather than finishing again
    // on the very next tick.
    expect(reopened.progress).toBeLessThan(100);
    expect(w.repos.bots.findById(approval.botId)!.status).toBe('working');

    const decided = w.repos.approvals.findById(approval.id)!;
    expect(decided.status).toBe('rejected');
    expect(decided.note).toBe('Add the enterprise tier');
  });

  it('reopened work asks for approval again when it finishes', () => {
    w = createTestWorld();
    const { task, approval } = pendingFor(w, 'Competitor landscape scan');
    w.workflow.reject(approval.id);

    const asked = w.fastForwardUntil(
      () => w.repos.tasks.findById(task.id)!.status === 'waiting_approval',
      300,
    );
    expect(asked).toBe(true);

    const second = w.repos.approvals.findPendingByTask(task.id);
    expect(second).not.toBeNull();
    expect(second!.id).not.toBe(approval.id);
  });

  it('refuses to decide the same request twice', () => {
    w = createTestWorld();
    const { approval } = pendingFor(w, 'Competitor landscape scan');
    w.workflow.approve(approval.id);

    expect(() => w.workflow.approve(approval.id)).toThrow(/already been decided/i);
    expect(() => w.workflow.reject(approval.id)).toThrow(/already been decided/i);
  });

  it('work that needs no approval is delivered without asking', () => {
    w = createTestWorld();
    const project = w.repos.projects.list()[0]!;
    w.workflow.cancelTask(taskByTitle(w.repos, 'Fix the checkout regression').id);

    const { task } = w.workflow.createTask({
      projectId: project.id,
      title: 'Bump the dependency',
      type: 'coding',
      needsApproval: false,
      botId: botByName(w.repos, 'Forge').id,
      autoStart: true,
    });

    const done = w.fastForwardUntil(
      () => w.repos.tasks.findById(task.id)!.status === 'completed',
      400,
    );
    expect(done).toBe(true);
    // It never stopped to ask.
    expect(w.repos.approvals.list().filter((a) => a.taskId === task.id)).toHaveLength(0);
  });

  it('every command writes an activity line', () => {
    w = createTestWorld();
    const before = w.repos.activity.list({ limit: 500 }).length;
    const task = taskByTitle(w.repos, 'Break the launch into workstreams');

    w.workflow.pauseTask(task.id);
    w.workflow.startTask(task.id);
    w.workflow.cancelTask(task.id);

    const after = w.repos.activity.list({ limit: 500 });
    expect(after.length).toBe(before + 3);
    expect(after.slice(0, 3).map((e) => e.kind)).toEqual(['cancelled', 'resumed', 'paused']);
  });
});

/**
 * A pending approval request whose task has moved on is a card in the queue
 * that can never be approved. Every route out of `waiting_approval` that is not
 * a decision has to withdraw the request, so this invariant is worth pinning
 * from all four directions.
 */
describe('no approval request is ever left dangling', () => {
  let w: TestWorld;
  afterEach(() => w?.close());

  /** Every pending request must point at work that is actually waiting. */
  const assertQueueIsCoherent = (w: TestWorld) => {
    for (const approval of w.repos.approvals.list({ status: 'pending' })) {
      const task = w.repos.tasks.findById(approval.taskId);
      expect(task, `approval ${approval.id} points at a task that no longer exists`).not.toBeNull();
      expect(
        task!.status,
        `“${task!.title}” has a pending approval but is ${task!.status}`,
      ).toBe('waiting_approval');
    }
  };

  it('withdraws it when the agent is reassigned to other work', () => {
    w = createTestWorld();
    const waiting = taskByTitle(w.repos, 'Competitor landscape scan');
    const nova = w.repos.bots.findById(waiting.botId!)!;
    const other = taskByTitle(w.repos, 'Summarise the customer interviews');

    w.workflow.assignTask(other.id, nova.id);

    expect(w.repos.approvals.findPendingByTask(waiting.id)).toBeNull();
    // The work is not lost: it keeps its progress and goes back on the board.
    const bumped = w.repos.tasks.findById(waiting.id)!;
    expect(bumped.status).toBe('backlog');
    expect(bumped.progress).toBe(100);
    assertQueueIsCoherent(w);
  });

  it('withdraws it when the task is taken off its agent', () => {
    w = createTestWorld();
    const waiting = taskByTitle(w.repos, 'Competitor landscape scan');

    w.workflow.unassignTask(waiting.id);

    expect(w.repos.approvals.findPendingByTask(waiting.id)).toBeNull();
    assertQueueIsCoherent(w);
  });

  it('withdraws it when the task is reset', () => {
    w = createTestWorld();
    const waiting = taskByTitle(w.repos, 'Competitor landscape scan');

    w.workflow.resetTask(waiting.id);

    expect(w.repos.approvals.findPendingByTask(waiting.id)).toBeNull();
    assertQueueIsCoherent(w);
  });

  it('withdraws it when the task is cancelled', () => {
    w = createTestWorld();
    const waiting = taskByTitle(w.repos, 'Competitor landscape scan');

    w.workflow.cancelTask(waiting.id);

    expect(w.repos.approvals.findPendingByTask(waiting.id)).toBeNull();
    assertQueueIsCoherent(w);
  });

  it('tells open screens the queue moved when the request was deleted rather than decided', () => {
    w = createTestWorld();
    const waiting = taskByTitle(w.repos, 'Competitor landscape scan');

    // Deleting cascades the row away, so there is no approval to broadcast —
    // the flag is the only thing that refreshes a queue someone is looking at.
    const changes = w.workflow.deleteTask(waiting.id);

    expect(changes.approvalsChanged).toBe(true);
    expect(w.repos.approvals.findPendingByTask(waiting.id)).toBeNull();
  });

  it('stays coherent through a long run of commands and ticks', () => {
    w = createTestWorld({ autoAssign: true });
    const project = w.repos.projects.list()[0]!;

    // Churn: create work, let it run, pull agents around, decide some of it.
    for (let round = 0; round < 4; round++) {
      w.workflow.createTask({
        projectId: project.id,
        title: `Churn task ${round}`,
        type: round % 2 === 0 ? 'research' : 'analysis',
      });
      w.fastForward(90);

      const pending = w.repos.approvals.list({ status: 'pending' });
      if (pending[0]) w.workflow.approve(pending[0].id);

      const bots = w.repos.bots.list();
      const open = w.repos.tasks.list({ status: 'backlog' });
      if (open[0] && bots[round % bots.length]) {
        w.workflow.assignTask(open[0].id, bots[round % bots.length]!.id);
      }
      w.fastForward(30);
      assertQueueIsCoherent(w);
    }
  });
});
