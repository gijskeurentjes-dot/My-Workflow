import { afterEach, describe, expect, it } from 'vitest';
import {
  AGENT_STATUSES,
  APPROVAL_PLOT,
  DELIVERY_PLOT,
  TASK_STATUSES,
  travelDurationMs,
} from '@ai-islands/shared';
import { agentByName, createTestWorld, taskByTitle, type TestWorld } from '../../test/helpers.js';

describe('the mock agent engine', () => {
  let w: TestWorld;
  afterEach(() => w?.close());

  it('advances a working task toward 100%', () => {
    w = createTestWorld();
    const before = taskByTitle(w.repos, 'Break the launch into workstreams');
    expect(before.status).toBe('working');

    w.fastForward(10);

    const after = w.repos.tasks.findById(before.id)!;
    expect(after.progress).toBeGreaterThan(before.progress);
    expect(after.progress).toBeLessThan(100);
  });

  it('mirrors task progress onto the agent, so the world view can render it cheaply', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Break the launch into workstreams');

    w.fastForward(10);

    const agent = w.repos.agents.findById(task.assignedAgentId!)!;
    expect(agent.progress).toBeCloseTo(w.repos.tasks.findById(task.id)!.progress, 5);
  });

  /**
   * The island is only legible if work happens where it says it does: research
   * at the library, code at the workshop, slides at the studio.
   */
  it('walks an agent to the building its task belongs to', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Break the launch into workstreams');

    w.fastForwardUntil(() => {
      const a = w.repos.agents.findById(task.assignedAgentId!)!;
      return !a.movement && a.currentLocation === task.buildingKey;
    }, 60);

    expect(w.repos.agents.findById(task.assignedAgentId!)!.currentLocation).toBe(task.buildingKey);
  });

  it('asks for approval instead of completing work on its own', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Break the launch into workstreams');
    expect(task.needsApproval).toBe(true);

    w.fastForward(200);

    const finished = w.repos.tasks.findById(task.id)!;
    expect(finished.status).toBe('waiting_approval');
    expect(finished.progress).toBe(100);
    // Crucially it did NOT complete itself.
    expect(finished.completedAt).toBeNull();
    expect(w.repos.agents.findById(task.assignedAgentId!)!.status).toBe('waiting_approval');
  });

  it('raises exactly one approval request when work finishes', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Break the launch into workstreams');

    // Well past the point it finished: a second request would mean the engine
    // re-raises approvals on every subsequent tick.
    w.fastForward(400);

    const raised = w.repos.approvals.list().filter((a) => a.taskId === task.id);
    expect(raised).toHaveLength(1);
    expect(raised[0]!.status).toBe('pending');
  });

  it('carries finished work to headquarters for your decision', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Break the launch into workstreams');

    w.fastForward(200);
    w.fastForward(40);

    const agent = w.repos.agents.findById(task.assignedAgentId!)!;
    expect(agent.currentLocation).toBe(APPROVAL_PLOT);
    expect(agent.movement).toBeNull();
  });

  it('holds a paused task at its progress and leaves the agent in place', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Launch deck: storyline and slides');
    expect(task.status).toBe('paused');
    const startedAt = w.repos.agents.findById(task.assignedAgentId!)!.currentLocation;

    w.fastForward(120);

    const after = w.repos.tasks.findById(task.id)!;
    expect(after.progress).toBe(task.progress);
    expect(after.status).toBe('paused');

    const agent = w.repos.agents.findById(task.assignedAgentId!)!;
    expect(agent.currentLocation).toBe(startedAt);
    expect(agent.status).toBe('paused');
  });

  it('leaves a blocked task blocked until something clears it', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Fix the checkout regression');
    expect(task.status).toBe('failed');
    expect(task.blocker).toBeTruthy();

    w.fastForward(120);

    const after = w.repos.tasks.findById(task.id)!;
    expect(after.status).toBe('failed');
    expect(after.progress).toBe(task.progress);
    expect(after.blocker).toBe(task.blocker);
  });

  it('carries approved work to the depot, crates it and frees the agent', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Competitor landscape scan');
    const agentId = task.assignedAgentId!;
    const cratesBefore = w.repos.projects.findById(task.projectId)!.crates;

    // Approving is a command; the engine's half of it is the walk and delivery.
    w.repos.tasks.update(task.id, { status: 'delivering' });

    const arrived = w.fastForwardUntil(
      () => w.repos.tasks.findById(task.id)!.status === 'completed',
      120,
    );
    expect(arrived, 'the delivery never completed').toBe(true);

    expect(w.repos.tasks.findById(task.id)!.completedAt).not.toBeNull();
    expect(w.repos.projects.findById(task.projectId)!.crates).toBe(cratesBefore + 1);

    // Completion only happens on arrival, so the agent is at the depot the
    // instant the task is done — and no longer holding it.
    const freed = w.repos.agents.findById(agentId)!;
    expect(freed.currentTaskId).toBeNull();
    expect(freed.currentLocation).toBe(DELIVERY_PLOT);
  });

  it('returns a celebrating agent to idle, then walks it back to rest', () => {
    w = createTestWorld({ celebrationMs: 1000 });
    const task = taskByTitle(w.repos, 'Competitor landscape scan');
    const agentId = task.assignedAgentId!;
    w.repos.tasks.update(task.id, { status: 'delivering' });

    expect(
      w.fastForwardUntil(() => w.repos.tasks.findById(task.id)!.status === 'completed', 120),
    ).toBe(true);
    expect(w.repos.agents.findById(agentId)!.status).toBe('completed');

    w.fastForward(60);
    const settled = w.repos.agents.findById(agentId)!;
    expect(settled.status).toBe('idle');
    expect(settled.currentLocation).toBe('rest');
  });

  it('never invents a status the UI does not know about', () => {
    w = createTestWorld({ autoAssign: true });
    w.fastForward(600);

    for (const agent of w.repos.agents.list()) expect(AGENT_STATUSES).toContain(agent.status);
    for (const task of w.repos.tasks.list()) expect(TASK_STATUSES).toContain(task.status);
  });

  it('only reports rows that actually changed', () => {
    w = createTestWorld();
    for (const task of w.repos.tasks.list()) {
      if (task.status === 'working') w.repos.tasks.update(task.id, { status: 'paused' });
    }
    w.fastForward(5);

    expect(w.engine.tick(w.now() + 250).tasks).toHaveLength(0);
  });

  /**
   * Teams are meaningful: an idle agent must not quietly do another project's
   * work, however well it matches.
   */
  it('never lets an agent pick up work from another project', () => {
    w = createTestWorld({ autoAssign: true });

    // Free every agent so the only constraint left is which project they're on.
    for (const task of w.repos.tasks.list()) {
      if (task.status !== 'backlog' && task.status !== 'completed') {
        w.repos.tasks.update(task.id, { status: 'cancelled', assignedAgentId: null });
      }
    }
    for (const agent of w.repos.agents.list()) {
      w.repos.agents.update(agent.id, { status: 'idle', currentTaskId: null });
    }

    w.fastForward(60);

    for (const task of w.repos.tasks.list()) {
      if (!task.assignedAgentId) continue;
      const agent = w.repos.agents.findById(task.assignedAgentId)!;
      expect(
        agent.projectId,
        `${agent.name} picked up work from a project they are not on`,
      ).toBe(task.projectId);
    }
  });

  it('gives waiting work to the agent on that project who owns the work', () => {
    w = createTestWorld({ autoAssign: true });
    const backlog = taskByTitle(w.repos, 'Summarise the customer interviews');
    expect(backlog.status).toBe('backlog');

    // Free Nova, the researcher on that project.
    const nova = agentByName(w.repos, 'Nova');
    w.repos.agents.update(nova.id, { status: 'idle', currentTaskId: null });
    w.repos.tasks.update(taskByTitle(w.repos, 'Competitor landscape scan').id, {
      status: 'cancelled',
      assignedAgentId: null,
    });

    w.fastForward(5);

    const picked = w.repos.tasks.findById(backlog.id)!;
    expect(picked.status).toBe('working');
    expect(picked.assignedAgentId).toBe(nova.id);
  });

  it('never assigns two tasks to one agent at once', () => {
    w = createTestWorld({ autoAssign: true });
    w.fastForward(900);

    const held = w.repos.agents
      .list()
      .map((a) => a.currentTaskId)
      .filter((id): id is string => id !== null);
    expect(new Set(held).size).toBe(held.length);
  });

  it('does not finish a long task instantly after the process was suspended', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Break the launch into workstreams');

    // One tick claiming ten minutes elapsed. Clamping means it advances by at
    // most a few seconds of work, not straight to done.
    w.engine.tick(w.now() + 600_000);

    expect(w.repos.tasks.findById(task.id)!.progress).toBeLessThan(100);
  });

  it('plans walks that match the shared road network', () => {
    // The client animates using the same function, so a mismatch here would
    // show up as an agent sliding through scenery.
    expect(travelDurationMs('rest', 'rest')).toBe(0);
    for (const to of ['hq', 'library', 'workshop', 'studio', 'data', 'depot', 'gate'] as const) {
      expect(travelDurationMs('rest', to), `no route from rest to ${to}`).toBeGreaterThan(0);
    }
  });

  it('writes an activity line for everything it does', () => {
    w = createTestWorld();
    const before = w.repos.activity.list({ limit: 500 }).length;

    w.fastForward(200);

    const after = w.repos.activity.list({ limit: 500 });
    expect(after.length).toBeGreaterThan(before);
    expect(after.some((e) => e.eventType === 'approval_requested')).toBe(true);
    for (const event of after) expect(event.message.length).toBeGreaterThan(0);
  });
});
