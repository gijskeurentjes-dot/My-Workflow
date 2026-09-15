import { afterEach, describe, expect, it } from 'vitest';
import { BOARD_COLUMNS, REST_PLOT, boardColumnFor, type TaskStatus } from '@ai-islands/shared';
import { WorkflowError } from '../errors.js';
import { createTestWorld, type TestWorld } from '../test/helpers.js';

/**
 * Managing the work, with or without the island.
 *
 * The board, dependencies, subtasks, milestones and the file register are a
 * task system in their own right: everything here is asserted through the
 * services, not the screens, because the brief asks for something useful even
 * with the visual world switched off. The world is checked separately, at the
 * end — it follows the work, not the other way round.
 */

interface Board {
  w: TestWorld;
  projectId: string;
  agentId: string;
}

function board(): Board {
  const w = createTestWorld({ seed: false });
  const { project } = w.workflow.createProject({
    name: 'Website refresh',
    goals: 'A pricing page that converts.',
    repository: 'github.com/example/site',
    team: ['researcher'],
  });
  const agent = w.repos.agents.findByProject(project.id)[0]!;
  return { w, projectId: project.id, agentId: agent.id };
}

const add = (b: Board, title: string, extra: Record<string, unknown> = {}) =>
  b.w.workflow.createTask({
    projectId: b.projectId,
    title,
    type: 'research',
    ...extra,
  }).task;

describe('the board', () => {
  let b: Board;
  afterEach(() => b?.w.close());

  it('gives every status exactly one lane', () => {
    const seen = new Map<TaskStatus, string>();
    for (const column of BOARD_COLUMNS) {
      for (const status of column.statuses) {
        expect(seen.has(status)).toBe(false);
        seen.set(status, column.key);
      }
    }
    // The seven lanes the brief asks for, in order.
    expect(BOARD_COLUMNS.map((c) => c.label)).toEqual([
      'Backlog',
      'To do',
      'In progress',
      'Waiting for approval',
      'Review',
      'Completed',
      'Failed',
    ]);
    expect(boardColumnFor('working')).toBe('in_progress');
    expect(boardColumnFor('delivering')).toBe('in_progress');
    expect(boardColumnFor('cancelled')).toBe('failed');
  });

  it('moves work from backlog to to-do and back', () => {
    b = board();
    const task = add(b, 'Draft the pricing page copy');

    b.w.workflow.moveTask(task.id, 'todo');
    expect(b.w.repos.tasks.findById(task.id)!.status).toBe('todo');

    b.w.workflow.moveTask(task.id, 'backlog');
    expect(b.w.repos.tasks.findById(task.id)!.status).toBe('backlog');
  });

  it('starts work that is sitting in to-do', () => {
    b = board();
    const task = add(b, 'Draft the copy', { agentId: b.agentId });
    b.w.workflow.moveTask(task.id, 'todo');

    b.w.workflow.startTask(task.id);
    expect(b.w.repos.tasks.findById(task.id)!.status).toBe('working');
  });

  it('refuses to move running work back to the board', () => {
    b = board();
    const task = add(b, 'Draft the copy', { agentId: b.agentId, autoStart: true });
    expect(() => b.w.workflow.moveTask(task.id, 'backlog')).toThrow(/running/i);
  });

  it('refuses to review work nobody has started', () => {
    b = board();
    const task = add(b, 'Draft the copy');
    expect(() => b.w.workflow.moveTask(task.id, 'review')).toThrow(/nothing to review/i);
  });

  it('takes finished work into review, withdrawing the approval it was waiting on', () => {
    b = board();
    const task = add(b, 'Draft the copy', { agentId: b.agentId, autoStart: true });
    b.w.fastForwardUntil(
      () => b.w.repos.tasks.findById(task.id)!.status === 'waiting_approval',
      400,
    );
    expect(b.w.repos.approvals.findPendingByTask(task.id)).not.toBeNull();

    b.w.workflow.moveTask(task.id, 'review');

    expect(b.w.repos.tasks.findById(task.id)!.status).toBe('review');
    expect(b.w.repos.agents.findById(b.agentId)!.status).toBe('review');
    // Nobody should be asked to approve something you have taken away to read.
    expect(b.w.repos.approvals.findPendingByTask(task.id)).toBeNull();
  });

  it('signs off reviewed work, and it goes out like anything else', () => {
    b = board();
    const task = add(b, 'Draft the copy', { agentId: b.agentId, autoStart: true });
    b.w.fastForwardUntil(
      () => b.w.repos.tasks.findById(task.id)!.status === 'waiting_approval',
      400,
    );
    b.w.workflow.moveTask(task.id, 'review');
    b.w.workflow.completeReview(task.id);

    expect(b.w.repos.tasks.findById(task.id)!.status).toBe('delivering');

    b.w.fastForwardUntil(() => b.w.repos.tasks.findById(task.id)!.status === 'completed', 400);
    expect(b.w.repos.tasks.findById(task.id)!.status).toBe('completed');
  });

  it('refuses to sign off work that is not in review', () => {
    b = board();
    const task = add(b, 'Draft the copy');
    expect(() => b.w.workflow.completeReview(task.id)).toThrow(WorkflowError);
  });
});

describe('dependencies', () => {
  let b: Board;
  afterEach(() => b?.w.close());

  it('records what a task is waiting for', () => {
    b = board();
    const first = add(b, 'Gather the numbers');
    const second = add(b, 'Write the summary');

    b.w.workflow.addDependency(second.id, first.id);

    expect(b.w.repos.tasks.findById(second.id)!.dependsOn).toEqual([first.id]);
    expect(b.w.repos.tasks.listDependents(first.id)).toEqual([second.id]);
  });

  /** The point of a dependency: it actually stops the work. */
  it('refuses to start work that is still waiting', () => {
    b = board();
    const first = add(b, 'Gather the numbers');
    const second = add(b, 'Write the summary', { agentId: b.agentId });
    b.w.workflow.addDependency(second.id, first.id);

    expect(() => b.w.workflow.startTask(second.id)).toThrow(/waiting on “Gather the numbers”/);
    expect(b.w.repos.tasks.findById(second.id)!.status).toBe('backlog');
  });

  it('lets it start once the thing it waited for is done', () => {
    b = board();
    const first = add(b, 'Gather the numbers');
    const second = add(b, 'Write the summary', { agentId: b.agentId });
    b.w.workflow.addDependency(second.id, first.id);

    b.w.repos.tasks.update(first.id, { status: 'completed', completedAt: Date.now() });

    b.w.workflow.startTask(second.id);
    expect(b.w.repos.tasks.findById(second.id)!.status).toBe('working');
  });

  /** A cancelled dependency still blocks: somebody decided it was not happening. */
  it('keeps blocking when the thing it waited for was called off', () => {
    b = board();
    const first = add(b, 'Gather the numbers');
    const second = add(b, 'Write the summary', { agentId: b.agentId });
    b.w.workflow.addDependency(second.id, first.id);

    b.w.workflow.cancelTask(first.id);
    expect(() => b.w.workflow.startTask(second.id)).toThrow(/waiting on/i);
  });

  it('refuses a loop neither task could start from', () => {
    b = board();
    const a = add(b, 'A');
    const c = add(b, 'B');
    b.w.workflow.addDependency(c.id, a.id);

    expect(() => b.w.workflow.addDependency(a.id, c.id)).toThrow(/loop/i);
  });

  it('refuses a loop through a chain of three', () => {
    b = board();
    const a = add(b, 'A');
    const c = add(b, 'B');
    const d = add(b, 'C');
    b.w.workflow.addDependency(c.id, a.id);
    b.w.workflow.addDependency(d.id, c.id);

    expect(() => b.w.workflow.addDependency(a.id, d.id)).toThrow(/loop/i);
  });

  it('refuses to wait on itself, or on another project’s work', () => {
    b = board();
    const task = add(b, 'A');
    expect(() => b.w.workflow.addDependency(task.id, task.id)).toThrow(/itself/i);

    const { project: other } = b.w.workflow.createProject({ name: 'Elsewhere' });
    const { task: stranger } = b.w.workflow.createTask({
      projectId: other.id,
      title: 'Not ours',
      type: 'research',
    });
    expect(() => b.w.workflow.addDependency(task.id, stranger.id)).toThrow(/same project/i);
  });

  it('can be removed again', () => {
    b = board();
    const first = add(b, 'A');
    const second = add(b, 'B', { agentId: b.agentId });
    b.w.workflow.addDependency(second.id, first.id);
    b.w.workflow.removeDependency(second.id, first.id);

    expect(b.w.repos.tasks.findById(second.id)!.dependsOn).toEqual([]);
    b.w.workflow.startTask(second.id);
    expect(b.w.repos.tasks.findById(second.id)!.status).toBe('working');
  });

  it('is not picked up by an idle agent either', () => {
    b = board();
    const first = add(b, 'Gather the numbers');
    const second = add(b, 'Write the summary');
    b.w.workflow.addDependency(second.id, first.id);

    // Auto-assign on: the simulation will take anything it is allowed to.
    const world = createTestWorld({ seed: false, autoAssign: true });
    world.close();
    b.w.engine.tick(Date.now());
    b.w.fastForward(10);

    expect(b.w.repos.tasks.findById(second.id)!.status).toBe('backlog');
  });

  it('can be set when the task is created', () => {
    b = board();
    const first = add(b, 'Gather the numbers');
    const second = add(b, 'Write the summary', { dependsOn: [first.id] });

    expect(b.w.repos.tasks.findById(second.id)!.dependsOn).toEqual([first.id]);
  });
});

describe('subtasks', () => {
  let b: Board;
  afterEach(() => b?.w.close());

  it('breaks a task into smaller ones', () => {
    b = board();
    const parent = add(b, 'Prepare the launch');
    const child = add(b, 'Write the copy', { parentTaskId: parent.id });

    expect(b.w.repos.tasks.findById(child.id)!.parentTaskId).toBe(parent.id);
    expect(
      b.w.repos.tasks.list({ projectId: b.projectId }).filter((t) => t.parentTaskId === parent.id),
    ).toHaveLength(1);
  });

  /** One level: deep trees are where task managers go to become unreadable. */
  it('refuses to nest a subtask under a subtask', () => {
    b = board();
    const parent = add(b, 'Prepare the launch');
    const child = add(b, 'Write the copy', { parentTaskId: parent.id });

    expect(() => add(b, 'Proofread it', { parentTaskId: child.id })).toThrow(/nesting/i);
  });

  it('refuses a parent in another project', () => {
    b = board();
    const { project: other } = b.w.workflow.createProject({ name: 'Elsewhere' });
    const { task: stranger } = b.w.workflow.createTask({
      projectId: other.id,
      title: 'Not ours',
      type: 'research',
    });
    expect(() => add(b, 'Mine', { parentTaskId: stranger.id })).toThrow(/same project/i);
  });
});

describe('milestones', () => {
  let b: Board;
  afterEach(() => b?.w.close());

  it('counts the work towards it', () => {
    b = board();
    const { milestone } = b.w.workflow.createMilestone({
      projectId: b.projectId,
      title: 'Pricing page live',
      dueAt: Date.now() + 86_400_000,
    });

    const first = add(b, 'Copy', { milestoneId: milestone.id });
    add(b, 'Design', { milestoneId: milestone.id });
    add(b, 'Unrelated');

    b.w.repos.tasks.update(first.id, { status: 'completed', completedAt: Date.now() });

    const view = b.w.world.listMilestoneViews(b.projectId)[0]!;
    expect(view.taskCount).toBe(2);
    expect(view.completedCount).toBe(1);
    expect(view.percent).toBe(50);
    expect(view.overdue).toBe(false);
  });

  it('knows when it is overdue', () => {
    b = board();
    b.w.workflow.createMilestone({
      projectId: b.projectId,
      title: 'Was due yesterday',
      dueAt: Date.now() - 86_400_000,
    });
    expect(b.w.world.listMilestoneViews(b.projectId)[0]!.overdue).toBe(true);
  });

  it('stops being overdue once it is hit', () => {
    b = board();
    const { milestone } = b.w.workflow.createMilestone({
      projectId: b.projectId,
      title: 'Was due yesterday',
      dueAt: Date.now() - 86_400_000,
    });
    b.w.workflow.updateMilestone(milestone.id, { status: 'hit' });
    expect(b.w.world.listMilestoneViews(b.projectId)[0]!.overdue).toBe(false);
  });

  /** The work is still real; it just stops counting towards anything. */
  it('leaves its tasks alone when it is deleted', () => {
    b = board();
    const { milestone } = b.w.workflow.createMilestone({
      projectId: b.projectId,
      title: 'Pricing page live',
    });
    const task = add(b, 'Copy', { milestoneId: milestone.id });

    b.w.workflow.deleteMilestone(milestone.id);

    const after = b.w.repos.tasks.findById(task.id)!;
    expect(after).not.toBeNull();
    expect(after.milestoneId).toBeNull();
  });

  it('refuses a milestone from another project', () => {
    b = board();
    const { project: other } = b.w.workflow.createProject({ name: 'Elsewhere' });
    const { milestone } = b.w.workflow.createMilestone({
      projectId: other.id,
      title: 'Theirs',
    });
    expect(() => add(b, 'Mine', { milestoneId: milestone.id })).toThrow(/different project/i);
  });
});

describe('project files', () => {
  let b: Board;
  afterEach(() => b?.w.close());

  it('records what the project has', () => {
    b = board();
    const { file } = b.w.workflow.addFile({
      projectId: b.projectId,
      name: 'pricing-research.md',
      kind: 'report',
      location: 'https://example.com/doc',
      note: 'The competitor scan.',
    });

    expect(b.w.repos.files.list({ projectId: b.projectId })).toHaveLength(1);
    expect(file.kind).toBe('report');
    expect(file.taskId).toBeNull();
  });

  it('links a deliverable to the task that produced it', () => {
    b = board();
    const task = add(b, 'Competitor scan');
    b.w.workflow.addFile({
      projectId: b.projectId,
      taskId: task.id,
      name: 'scan.md',
      kind: 'report',
    });

    const deliverables = b.w.repos.files.list({ taskId: task.id });
    expect(deliverables).toHaveLength(1);
    expect(deliverables[0]!.name).toBe('scan.md');
    expect(
      b.w.repos.activity.list({ taskId: task.id }).some((e) => e.message.includes('deliverable')),
    ).toBe(true);
  });

  it('refuses a deliverable for another project’s task', () => {
    b = board();
    const { project: other } = b.w.workflow.createProject({ name: 'Elsewhere' });
    const { task: stranger } = b.w.workflow.createTask({
      projectId: other.id,
      title: 'Not ours',
      type: 'research',
    });
    expect(() =>
      b.w.workflow.addFile({ projectId: b.projectId, taskId: stranger.id, name: 'x.md' }),
    ).toThrow(/different project/i);
  });

  it('removes a reference without pretending to delete anything', () => {
    b = board();
    const { file } = b.w.workflow.addFile({ projectId: b.projectId, name: 'x.md' });
    b.w.workflow.removeFile(file.id);
    expect(b.w.repos.files.list({ projectId: b.projectId })).toHaveLength(0);
  });
});

describe('the project itself', () => {
  let b: Board;
  afterEach(() => b?.w.close());

  it('carries its goals and its repository', () => {
    b = board();
    const project = b.w.repos.projects.findById(b.projectId)!;
    expect(project.goals).toBe('A pricing page that converts.');
    expect(project.repository).toBe('github.com/example/site');
  });

  it('can have them edited afterwards', () => {
    b = board();
    b.w.workflow.updateProject(b.projectId, {
      goals: 'A pricing page that converts, and a deck the exec team signs off.',
      repository: 'github.com/example/pricing',
    });
    const project = b.w.repos.projects.findById(b.projectId)!;
    expect(project.goals).toContain('signs off');
    expect(project.repository).toBe('github.com/example/pricing');
  });
});

describe('the world follows the work', () => {
  let b: Board;
  afterEach(() => b?.w.close());

  it('sends an agent to the meeting circle when its work is in review', () => {
    b = board();
    const task = add(b, 'Draft the copy', { agentId: b.agentId, autoStart: true });
    b.w.fastForwardUntil(
      () => b.w.repos.tasks.findById(task.id)!.status === 'waiting_approval',
      400,
    );

    b.w.workflow.moveTask(task.id, 'review');
    b.w.fastForwardUntil(
      () => b.w.repos.agents.findById(b.agentId)!.currentLocation === REST_PLOT,
      200,
    );

    expect(b.w.repos.agents.findById(b.agentId)!.currentLocation).toBe(REST_PLOT);
    expect(b.w.repos.agents.findById(b.agentId)!.status).toBe('review');
  });

  it('frees the agent when work goes back to the board', () => {
    b = board();
    const task = add(b, 'Draft the copy', { agentId: b.agentId });
    b.w.workflow.moveTask(task.id, 'todo');
    b.w.workflow.moveTask(task.id, 'backlog');

    const agent = b.w.repos.agents.findById(b.agentId)!;
    expect(agent.currentTaskId).toBeNull();
    expect(b.w.repos.tasks.findById(task.id)!.assignedAgentId).toBeNull();
  });
});
