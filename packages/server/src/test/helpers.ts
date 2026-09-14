import { seedWorld } from '../db/seed.js';
import { openDatabase, type Db } from '../db/sqlite.js';
import { createSqliteRepositories } from '../repositories/sqlite/index.js';
import type { Repositories } from '../repositories/types.js';
import { MockAgentEngine, type MockAgentEngineOptions } from '../services/agents/mock-agent-engine.js';
import { WorldService } from '../services/world.service.js';

export interface TestWorld {
  db: Db;
  repos: Repositories;
  engine: MockAgentEngine;
  world: WorldService;
  /**
   * Step the simulation forward by `seconds` of simulated time.
   *
   * The engine reads the clock, so tests advance a fake `now` rather than
   * sleeping — a two-minute task finishes in microseconds and never flakes.
   */
  fastForward(seconds: number, stepMs?: number): void;
  /**
   * Step until `predicate` holds, so a test can assert on the moment something
   * happens rather than guessing how many seconds to skip. Returns false if the
   * condition never came true within `maxSeconds`.
   */
  fastForwardUntil(predicate: () => boolean, maxSeconds?: number, stepMs?: number): boolean;
  now(): number;
  close(): void;
}

export interface TestWorldOptions extends MockAgentEngineOptions {
  seed?: boolean;
  startAt?: number;
}

/** Build a complete, isolated world in memory. */
export function createTestWorld(options: TestWorldOptions = {}): TestWorld {
  const db = openDatabase(':memory:');
  const repos = createSqliteRepositories(db);

  let clock = options.startAt ?? Date.now();

  if (options.seed !== false) seedWorld(repos, clock);

  const engine = new MockAgentEngine(repos, {
    tickMs: options.tickMs ?? 250,
    autoAssign: options.autoAssign ?? false,
    ...(options.celebrationMs !== undefined ? { celebrationMs: options.celebrationMs } : {}),
    ...(options.onChange ? { onChange: options.onChange } : {}),
  });

  const world = new WorldService(repos, engine);

  return {
    db,
    repos,
    engine,
    world,
    now: () => clock,
    fastForward(seconds: number, stepMs = 250): void {
      const steps = Math.max(1, Math.round((seconds * 1000) / stepMs));
      for (let i = 0; i < steps; i++) {
        clock += stepMs;
        engine.tick(clock);
      }
    },
    fastForwardUntil(predicate: () => boolean, maxSeconds = 600, stepMs = 250): boolean {
      const steps = Math.round((maxSeconds * 1000) / stepMs);
      for (let i = 0; i < steps; i++) {
        clock += stepMs;
        engine.tick(clock);
        if (predicate()) return true;
      }
      return false;
    },
    close(): void {
      engine.stop();
      db.close();
    },
  };
}

/** Find a seeded task by its title, failing loudly if the seed changed. */
export function taskByTitle(repos: Repositories, title: string) {
  const task = repos.tasks.list().find((t) => t.title === title);
  if (!task) throw new Error(`No seeded task titled "${title}"`);
  return task;
}

export function botByName(repos: Repositories, name: string) {
  const bot = repos.bots.list().find((b) => b.name === name);
  if (!bot) throw new Error(`No seeded bot named "${name}"`);
  return bot;
}
