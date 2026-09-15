import { afterEach, describe, expect, it } from 'vitest';
import { buildApprovalRequest } from '@ai-islands/shared';
import { newId } from '../ids.js';
import { createTestWorld, type TestWorld } from '../test/helpers.js';
import { reconcileAgentStates } from './recovery.js';

/**
 * The things a person notices, and the things that would quietly mislead them.
 *
 * These came out of driving the finished app as a user rather than reading the
 * code: each one is a place where the interface could say something the
 * backend does not actually mean.
 */

describe('an agent’s status describes the work it is holding', () => {
  let w: TestWorld;
  afterEach(() => w?.close());

  const world = () => {
    w = createTestWorld({ seed: false });
    const { project } = w.workflow.createProject({ name: 'Launch', team: ['pm'] });
    const agent = w.repos.agents.findByProject(project.id)[0]!;
    return { project, agent };
  };

  /**
   * Found by clicking: an agent that had finished work waiting for approval,
   * then got moved to something else, went on saying "Waiting for approval"
   * with nothing waiting. The island claimed a decision was pending when none
   * was — exactly the kind of lie this app exists not to tell.
   */
  it('stops saying it is waiting for you once it is moved to other work', () => {
    const { project, agent } = world();

    const { task: finished } = w.workflow.createTask({
      projectId: project.id,
      title: 'Finished work',
      type: 'planning',
      agentId: agent.id,
      autoStart: true,
    });
    w.fastForwardUntil(
      () => w.repos.tasks.findById(finished.id)!.status === 'waiting_approval',
      400,
    );
    expect(w.repos.agents.findById(agent.id)!.status).toBe('waiting_approval');

    const { task: next } = w.workflow.createTask({
      projectId: project.id,
      title: 'Something else entirely',
      type: 'planning',
    });
    w.workflow.assignTask(next.id, agent.id);

    const moved = w.repos.agents.findById(agent.id)!;
    expect(moved.currentTaskId).toBe(next.id);
    // The new task is on the board, so the agent has nothing to do — and
    // certainly is not waiting on a decision.
    expect(moved.status).toBe('idle');
    expect(w.repos.approvals.list({ status: 'pending' })).toHaveLength(0);
  });

  it('shows the new task’s progress, not the old one’s', () => {
    const { project, agent } = world();

    const { task: started } = w.workflow.createTask({
      projectId: project.id,
      title: 'Half done',
      type: 'planning',
      agentId: agent.id,
      autoStart: true,
    });
    w.fastForwardUntil(() => w.repos.tasks.findById(started.id)!.progress > 20, 200);
    expect(w.repos.agents.findById(agent.id)!.progress).toBeGreaterThan(0);

    const { task: fresh } = w.workflow.createTask({
      projectId: project.id,
      title: 'Not started',
      type: 'planning',
    });
    w.workflow.assignTask(fresh.id, agent.id);

    expect(w.repos.agents.findById(agent.id)!.progress).toBe(0);
  });

  it('takes on the state of work that is already under way', () => {
    const { project, agent } = world();
    const { agent: other } = w.workflow.hireAgent(project.id, 'developer', 'Bolt');

    const { task } = w.workflow.createTask({
      projectId: project.id,
      title: 'Already running',
      type: 'coding',
      agentId: other.id,
      autoStart: true,
    });
    expect(w.repos.tasks.findById(task.id)!.status).toBe('working');

    w.workflow.assignTask(task.id, agent.id);

    expect(w.repos.agents.findById(agent.id)!.status).toBe('working');
    // And whoever had it is free again.
    expect(w.repos.agents.findById(other.id)!.currentTaskId).toBeNull();
  });
});

describe('a world that woke up inconsistent', () => {
  let w: TestWorld;
  afterEach(() => w?.close());

  /**
   * Rows written by an older build, or a process killed mid-write, can leave an
   * agent describing work it no longer holds. Boot repairs it rather than
   * letting the island keep the claim.
   */
  it('puts an agent back to idle when it says it is waiting on nothing', () => {
    w = createTestWorld({ seed: false });
    const { project } = w.workflow.createProject({ name: 'Launch', team: ['pm'] });
    const agent = w.repos.agents.findByProject(project.id)[0]!;
    const { task } = w.workflow.createTask({
      projectId: project.id,
      title: 'On the board',
      type: 'planning',
      agentId: agent.id,
    });

    // Exactly the shape the old reassignment bug left behind.
    w.repos.agents.update(agent.id, { status: 'waiting_approval', progress: 61 });

    reconcileAgentStates(w.repos);

    const fixed = w.repos.agents.findById(agent.id)!;
    expect(fixed.status).toBe('idle');
    expect(fixed.progress).toBe(0);
    expect(fixed.currentTaskId).toBe(task.id);
  });

  it('frees an agent whose task has gone', () => {
    w = createTestWorld({ seed: false });
    const { project } = w.workflow.createProject({ name: 'Launch', team: ['pm'] });
    const agent = w.repos.agents.findByProject(project.id)[0]!;

    w.repos.agents.update(agent.id, { status: 'working', currentTaskId: 'tsk_gone' });

    reconcileAgentStates(w.repos);

    const fixed = w.repos.agents.findById(agent.id)!;
    expect(fixed.status).toBe('idle');
    expect(fixed.currentTaskId).toBeNull();
  });

  it('leaves a healthy world completely alone', () => {
    w = createTestWorld();
    const before = w.repos.agents.list().map((a) => `${a.id}:${a.status}:${a.currentTaskId}`);

    reconcileAgentStates(w.repos);

    expect(w.repos.agents.list().map((a) => `${a.id}:${a.status}:${a.currentTaskId}`)).toEqual(
      before,
    );
  });
});

describe('what live runs cost', () => {
  let w: TestWorld;
  afterEach(() => w?.close());

  const withResults = () => {
    w = createTestWorld({ seed: false });
    const { project } = w.workflow.createProject({ name: 'Research', team: ['researcher'] });
    const agent = w.repos.agents.findByProject(project.id)[0]!;
    const { task } = w.workflow.createTask({
      projectId: project.id,
      title: 'Scan',
      type: 'research',
      agentId: agent.id,
    });
    return { project, agent, task };
  };

  it('counts nothing when nothing has run for real', () => {
    w = createTestWorld({ seed: false });
    const report = w.world.usage();
    expect(report.total.runs).toBe(0);
    expect(report.total.outputTokens).toBe(0);
    expect(report.byAgent).toEqual([]);
    expect(report.byProject).toEqual([]);
  });

  it('adds up the runs an agent actually made', () => {
    const { project, agent, task } = withResults();

    for (const [input, output, searches] of [
      [1000, 400, 3],
      [2000, 600, 5],
    ] as const) {
      w.repos.results.create({
        id: newId('res'),
        taskId: task.id,
        agentId: agent.id,
        summary: 'Done',
        report: null,
        rawText: '',
        model: 'claude-opus-5',
        stopReason: 'end_turn',
        usage: {
          inputTokens: input,
          outputTokens: output,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          webSearches: searches,
        },
        durationMs: 5_000,
        createdAt: Date.now(),
      });
    }

    const report = w.world.usage();
    expect(report.total.runs).toBe(2);
    expect(report.total.inputTokens).toBe(3000);
    expect(report.total.outputTokens).toBe(1000);
    expect(report.total.webSearches).toBe(8);
    expect(report.total.durationMs).toBe(10_000);

    expect(report.byAgent).toHaveLength(1);
    expect(report.byAgent[0]!.name).toBe(agent.name);
    expect(report.byAgent[0]!.usage.runs).toBe(2);

    expect(report.byProject).toHaveLength(1);
    expect(report.byProject[0]!.name).toBe(project.name);
    expect(report.byProject[0]!.usage.outputTokens).toBe(1000);
  });

  /** Simulated work costs nothing, and must never be counted as though it did. */
  it('ignores simulated work entirely', () => {
    w = createTestWorld({ seed: false });
    const { project } = w.workflow.createProject({ name: 'Simulated', team: ['pm'] });
    const agent = w.repos.agents.findByProject(project.id)[0]!;
    const { task } = w.workflow.createTask({
      projectId: project.id,
      title: 'Busywork',
      type: 'planning',
      agentId: agent.id,
      autoStart: true,
    });
    w.fastForwardUntil(() => w.repos.tasks.findById(task.id)!.status !== 'working', 400);

    expect(w.world.usage().total.runs).toBe(0);
  });
});

describe('nothing is left waiting on a decision nobody can make', () => {
  let w: TestWorld;
  afterEach(() => w?.close());

  it('withdraws the request when the work it belonged to is called off', () => {
    w = createTestWorld({ seed: false });
    const { project } = w.workflow.createProject({ name: 'Launch', team: ['pm'] });
    const agent = w.repos.agents.findByProject(project.id)[0]!;
    const { task } = w.workflow.createTask({
      projectId: project.id,
      title: 'Work',
      type: 'planning',
      agentId: agent.id,
    });

    w.repos.approvals.create(
      buildApprovalRequest({
        id: newId('apr'),
        taskId: task.id,
        agentId: agent.id,
        summary: 'Deliver the work',
        requestedAt: Date.now(),
      }),
    );
    w.repos.tasks.update(task.id, { status: 'waiting_approval' });

    w.workflow.cancelTask(task.id);

    expect(w.repos.approvals.list({ status: 'pending' })).toHaveLength(0);
    expect(w.repos.approvals.list({ status: 'cancelled' })).toHaveLength(1);
  });
});
