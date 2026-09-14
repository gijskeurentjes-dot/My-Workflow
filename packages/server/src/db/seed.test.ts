import { afterEach, describe, expect, it } from 'vitest';
import { BOT_PROFILES, ISLAND_DEFS, TASK_TYPES } from '@ai-islands/shared';
import { createTestWorld, type TestWorld } from '../test/helpers.js';
import { seedWorld } from './seed.js';

describe('the demo world', () => {
  let w: TestWorld;
  afterEach(() => w?.close());

  it('creates one island per work area', () => {
    w = createTestWorld();
    const islands = w.repos.islands.list();
    expect(islands).toHaveLength(ISLAND_DEFS.length);
    expect(islands.map((i) => i.key).sort()).toEqual(ISLAND_DEFS.map((d) => d.key).sort());
  });

  it('gives every agent a home island', () => {
    w = createTestWorld();
    const bots = w.repos.bots.list();
    expect(bots).toHaveLength(5);

    for (const bot of bots) {
      const island = w.repos.islands.findById(bot.islandId);
      expect(island, `${bot.name} has no island`).not.toBeNull();
      expect(island!.key).toBe(BOT_PROFILES[bot.key].homeIsland);
    }
  });

  it('routes every task to the island its type belongs to', () => {
    w = createTestWorld();
    for (const task of w.repos.tasks.list()) {
      const island = w.repos.islands.findById(task.islandId);
      expect(island!.key).toBe(TASK_TYPES[task.type].island);
    }
  });

  it('shows every state the UI has to render', () => {
    w = createTestWorld();
    const botStatuses = new Set(w.repos.bots.list().map((b) => b.status));
    // A first-time visitor should see someone working, someone waiting on them,
    // someone blocked and someone paused without touching anything.
    expect(botStatuses).toContain('working');
    expect(botStatuses).toContain('waiting_approval');
    expect(botStatuses).toContain('failed');
    expect(botStatuses).toContain('paused');

    const taskStatuses = new Set(w.repos.tasks.list().map((t) => t.status));
    expect(taskStatuses).toContain('backlog');
    expect(taskStatuses).toContain('completed');
  });

  it('leaves an approval waiting in the queue', () => {
    w = createTestWorld();
    const pending = w.repos.approvals.list({ status: 'pending' });
    expect(pending).toHaveLength(1);

    const task = w.repos.tasks.findById(pending[0]!.taskId);
    expect(task?.status).toBe('waiting_approval');
  });

  it('keeps bot and task agreed on who holds what', () => {
    w = createTestWorld();
    for (const bot of w.repos.bots.list()) {
      if (!bot.taskId) continue;
      const task = w.repos.tasks.findById(bot.taskId);
      expect(task, `${bot.name} holds a task that does not exist`).not.toBeNull();
      expect(task!.botId).toBe(bot.id);
    }
    // And the reverse: a live task's bot points back at it.
    for (const task of w.repos.tasks.list()) {
      if (!task.botId || task.status === 'completed') continue;
      const bot = w.repos.bots.findById(task.botId);
      expect(bot!.taskId).toBe(task.id);
    }
  });

  it('crates the work that was already delivered', () => {
    w = createTestWorld();
    const crates = w.repos.islands.list().reduce((sum, i) => sum + i.crates, 0);
    const completed = w.repos.tasks.list({ status: 'completed' }).length;
    expect(crates).toBe(completed);
  });

  it('is reproducible — a reset replays the same world', () => {
    w = createTestWorld();
    const before = w.repos.tasks.list().map((t) => t.title).sort();

    w.repos.reset();
    expect(w.repos.islands.list()).toHaveLength(0);

    // Re-seed and compare shape, not ids, which are random by design.
    seedWorld(w.repos, w.now());
    expect(w.repos.tasks.list().map((t) => t.title).sort()).toEqual(before);
  });
});
