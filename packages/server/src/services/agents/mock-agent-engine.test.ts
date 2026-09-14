import { afterEach, describe, expect, it } from 'vitest';
import { BOT_STATUSES, TASK_STATUSES, travelDurationMs } from '@ai-islands/shared';
import { botByName, createTestWorld, taskByTitle, type TestWorld } from '../../test/helpers.js';

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

  it('mirrors task progress onto the bot, so the world view can render it cheaply', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Break the launch into workstreams');

    w.fastForward(10);

    const bot = w.repos.bots.findById(task.botId!)!;
    const updated = w.repos.tasks.findById(task.id)!;
    expect(bot.progress).toBeCloseTo(updated.progress, 5);
  });

  it('asks for approval instead of completing work on its own', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Break the launch into workstreams');
    expect(task.needsApproval).toBe(true);

    // Long enough for a 150s task to finish several times over.
    w.fastForward(200);

    const finished = w.repos.tasks.findById(task.id)!;
    expect(finished.status).toBe('waiting_approval');
    expect(finished.progress).toBe(100);
    // Crucially it did NOT complete itself.
    expect(finished.completedAt).toBeNull();

    const bot = w.repos.bots.findById(task.botId!)!;
    expect(bot.status).toBe('waiting_approval');
  });

  it('raises exactly one approval request when work finishes', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Break the launch into workstreams');

    // Keep running well past the point the task finished: a second request
    // would mean the engine re-raises approvals on every subsequent tick.
    w.fastForward(400);

    const raised = w.repos.approvals.list().filter((a) => a.taskId === task.id);
    expect(raised).toHaveLength(1);
    expect(raised[0]!.status).toBe('pending');
  });

  it('walks the finished agent to the approval post', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Break the launch into workstreams');

    w.fastForward(200);
    const bot = w.repos.bots.findById(task.botId!)!;

    // It either arrived, or is on its way there — never somewhere else.
    const heading = bot.movement?.toKey ?? bot.locationKey;
    expect(heading).toBe('approval');

    // Give it time to finish the walk.
    w.fastForward(30);
    const arrived = w.repos.bots.findById(task.botId!)!;
    expect(arrived.locationKey).toBe('approval');
    expect(arrived.movement).toBeNull();
  });

  it('holds a paused task at its progress and leaves the agent in place', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Launch deck: storyline and slides');
    expect(task.status).toBe('paused');
    const bot = w.repos.bots.findById(task.botId!)!;
    const startedAt = bot.locationKey;

    w.fastForward(120);

    const after = w.repos.tasks.findById(task.id)!;
    expect(after.progress).toBe(task.progress);
    expect(after.status).toBe('paused');

    const botAfter = w.repos.bots.findById(task.botId!)!;
    expect(botAfter.locationKey).toBe(startedAt);
    expect(botAfter.status).toBe('paused');
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
    const bot = w.repos.bots.findById(task.botId!)!;
    const island = w.repos.islands.findById(task.islandId)!;
    const cratesBefore = island.crates;

    // Approving is an M2 action; the engine's half of it is the walk and the
    // delivery, which is what this exercises.
    w.repos.tasks.update(task.id, { status: 'delivering' });

    const arrived = w.fastForwardUntil(
      () => w.repos.tasks.findById(task.id)!.status === 'completed',
      120,
    );
    expect(arrived, 'the delivery never completed').toBe(true);

    const delivered = w.repos.tasks.findById(task.id)!;
    expect(delivered.completedAt).not.toBeNull();
    expect(w.repos.islands.findById(island.id)!.crates).toBe(cratesBefore + 1);

    // Completion only happens on arrival, so the bot is at the depot the
    // instant the task is done — and is no longer holding it.
    const freed = w.repos.bots.findById(bot.id)!;
    expect(freed.taskId).toBeNull();
    expect(freed.locationKey).toBe('depot');
  });

  it('returns a celebrating agent to idle, then walks it back to rest', () => {
    w = createTestWorld({ celebrationMs: 1000 });
    const task = taskByTitle(w.repos, 'Competitor landscape scan');
    const botId = task.botId!;
    w.repos.tasks.update(task.id, { status: 'delivering' });

    const done = w.fastForwardUntil(
      () => w.repos.tasks.findById(task.id)!.status === 'completed',
      120,
    );
    expect(done).toBe(true);
    expect(w.repos.bots.findById(botId)!.status).toBe('completed');

    w.fastForward(60);
    const settled = w.repos.bots.findById(botId)!;
    expect(settled.status).toBe('idle');
    expect(settled.locationKey).toBe('rest');
  });

  it('never invents a status the UI does not know about', () => {
    w = createTestWorld({ autoAssign: true });
    w.fastForward(600);

    for (const bot of w.repos.bots.list()) {
      expect(BOT_STATUSES).toContain(bot.status);
    }
    for (const task of w.repos.tasks.list()) {
      expect(TASK_STATUSES).toContain(task.status);
    }
  });

  it('only reports rows that actually changed', () => {
    w = createTestWorld();
    // A world where everything is paused or blocked has nothing to report.
    for (const task of w.repos.tasks.list()) {
      if (task.status === 'working') w.repos.tasks.update(task.id, { status: 'paused' });
    }
    w.fastForward(5);

    const quiet = w.engine.tick(w.now() + 250);
    expect(quiet.tasks).toHaveLength(0);
  });

  it('gives waiting work to the agent that owns that kind of task', () => {
    w = createTestWorld({ autoAssign: true });
    const backlog = taskByTitle(w.repos, 'Summarise the customer interviews');
    expect(backlog.status).toBe('backlog');

    // Nova is holding the approval; free her so she can take research work.
    const nova = botByName(w.repos, 'Nova');
    w.repos.bots.update(nova.id, { status: 'idle', taskId: null });
    w.repos.tasks.update(taskByTitle(w.repos, 'Competitor landscape scan').id, {
      status: 'cancelled',
      botId: null,
    });

    w.fastForward(5);

    const picked = w.repos.tasks.findById(backlog.id)!;
    expect(picked.status).toBe('working');
    expect(picked.botId).toBe(nova.id);
  });

  it('never assigns two tasks to one agent at once', () => {
    w = createTestWorld({ autoAssign: true });
    w.fastForward(900);

    const held = w.repos.bots
      .list()
      .map((b) => b.taskId)
      .filter((id): id is string => id !== null);
    expect(new Set(held).size).toBe(held.length);

    // And no live task is claimed by two agents.
    for (const task of w.repos.tasks.list()) {
      if (!task.botId) continue;
      const claimants = w.repos.bots.list().filter((b) => b.taskId === task.id);
      expect(claimants.length).toBeLessThanOrEqual(1);
    }
  });

  it('does not finish a long task instantly after the process was suspended', () => {
    w = createTestWorld();
    const task = taskByTitle(w.repos, 'Break the launch into workstreams');

    // One tick claiming ten minutes elapsed. Clamping means it advances by at
    // most a few seconds of work, not straight to done.
    w.engine.tick(w.now() + 600_000);

    const after = w.repos.tasks.findById(task.id)!;
    expect(after.progress).toBeLessThan(100);
  });

  it('plans walks that match the shared road network', () => {
    // The client animates using the same function, so a mismatch here would
    // show up as a bot sliding through scenery.
    expect(travelDurationMs('rest', 'rest')).toBe(0);
    expect(travelDurationMs('rest', 'workbench')).toBeGreaterThan(0);
    expect(travelDurationMs('workbench', 'depot')).toBeGreaterThan(0);
  });

  it('writes an activity line for everything it does', () => {
    w = createTestWorld();
    const before = w.repos.activity.list({ limit: 500 }).length;

    w.fastForward(200);

    const after = w.repos.activity.list({ limit: 500 });
    expect(after.length).toBeGreaterThan(before);
    expect(after.some((e) => e.kind === 'approval_requested')).toBe(true);
    for (const event of after) {
      expect(event.message.length).toBeGreaterThan(0);
    }
  });
});
