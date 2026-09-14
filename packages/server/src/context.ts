import { config } from './config.js';
import { isEmptyWorld, seedWorld } from './db/seed.js';
import { openDatabase, type Db } from './db/sqlite.js';
import { createSqliteRepositories } from './repositories/sqlite/index.js';
import type { Repositories } from './repositories/types.js';
import { Broadcaster } from './realtime/broadcaster.js';
import type { AgentEngine, EngineChanges } from './services/agents/agent-engine.js';
import { MockAgentEngine } from './services/agents/mock-agent-engine.js';
import { WorldService } from './services/world.service.js';

/**
 * Everything the app is built from, wired together in one place.
 *
 * Routes receive this rather than importing singletons, which is what lets a
 * test stand up a complete in-memory application in three lines.
 */
export interface AppContext {
  db: Db;
  repos: Repositories;
  engine: AgentEngine;
  world: WorldService;
  broadcaster: Broadcaster;
  /** Wipe the world and replay the demo seed. */
  resetDemoData(): void;
  shutdown(): void;
}

export interface CreateContextOptions {
  databasePath?: string;
  tickMs?: number;
  /** Whether idle bots take work off the board unprompted. */
  autoAssign?: boolean;
  /** Skip seeding — tests that build their own fixtures pass false. */
  seed?: boolean;
  /** Start the engine timer immediately. Tests tick by hand instead. */
  autoStart?: boolean;
}

/** Choose an engine from configuration. Only 'mock' exists today. */
function buildEngine(
  repos: Repositories,
  options: { tickMs: number; autoAssign: boolean; onChange: (c: EngineChanges) => void },
): AgentEngine {
  switch (config.agentEngine) {
    case 'mock':
      return new MockAgentEngine(repos, options);
    case 'claude':
      // Deliberately explicit: the switch exists so the wiring is ready, but
      // pretending a real engine is present would be worse than refusing.
      throw new Error(
        'AGENT_ENGINE=claude is not implemented yet. The Claude-backed engine lands in a later milestone; use AGENT_ENGINE=mock.',
      );
    default:
      throw new Error(`Unknown AGENT_ENGINE "${config.agentEngine}". Expected "mock".`);
  }
}

export function createContext(options: CreateContextOptions = {}): AppContext {
  const db = openDatabase(options.databasePath ?? config.databasePath);
  const repos = createSqliteRepositories(db);
  const broadcaster = new Broadcaster(config.heartbeatMs);

  const engine = buildEngine(repos, {
    tickMs: options.tickMs ?? config.agentTickMs,
    autoAssign: options.autoAssign ?? true,
    onChange: (changes) => {
      const at = Date.now();
      if (changes.bots.length || changes.tasks.length) {
        broadcaster.broadcast({
          type: 'tick',
          at,
          bots: changes.bots,
          tasks: changes.tasks,
          stats: world.stats(),
        });
      }
      if (changes.activity.length) {
        // Newest first, matching the order the activity log renders in.
        broadcaster.broadcast({ type: 'activity', at, events: [...changes.activity].reverse() });
      }
      if (changes.approvals.length) {
        broadcaster.broadcast({ type: 'approvals', at, approvals: repos.approvals.list() });
      }
      if (changes.islandsChanged) {
        broadcaster.broadcast({ type: 'islands', at, islands: repos.islands.list() });
      }
    },
  });

  const world = new WorldService(repos, engine, config.activityLimit);

  if (options.seed !== false && isEmptyWorld(repos)) {
    seedWorld(repos);
  }

  if (options.autoStart !== false) {
    engine.start();
  }

  return {
    db,
    repos,
    engine,
    world,
    broadcaster,

    resetDemoData(): void {
      repos.reset();
      seedWorld(repos);
      // A reset changes everything, so send a whole snapshot rather than trying
      // to describe the delta.
      broadcaster.broadcast({ type: 'snapshot', at: Date.now(), world: world.snapshot() });
    },

    shutdown(): void {
      engine.stop();
      broadcaster.closeAll();
      db.close();
    },
  };
}
