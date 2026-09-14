import { config } from './config.js';
import { isEmptyWorld, seedWorld } from './db/seed.js';
import { openDatabase, type Db } from './db/sqlite.js';
import { createSqliteRepositories } from './repositories/sqlite/index.js';
import type { Repositories } from './repositories/types.js';
import { Broadcaster } from './realtime/broadcaster.js';
import type { AgentEngine, EngineChanges } from './services/agents/agent-engine.js';
import { MockAgentEngine } from './services/agents/mock-agent-engine.js';
import { WorldService } from './services/world.service.js';
import { WorkflowService } from './services/workflow.service.js';
import { TaskExecutionService } from './services/task-execution.service.js';
import { buildAgentRunners } from './services/agents/claude/runners.js';

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
  workflow: WorkflowService;
  /** Runs a task against a real agent. Present even with no API key. */
  execution: TaskExecutionService;
  broadcaster: Broadcaster;
  /**
   * Push a set of changes to every connected browser.
   *
   * Routes call this after a command so a click and an engine tick reach the
   * UI by exactly the same path — there is no second way for state to arrive.
   */
  publish(changes: EngineChanges): void;
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

  /**
   * Turn a set of changes into stream events.
   *
   * Declared before the engine so both the engine's ticks and the workflow
   * service's commands can hand changes to the same function.
   */
  const publish = (changes: EngineChanges): void => {
    const at = Date.now();
    if (changes.agents.length || changes.tasks.length) {
      broadcaster.broadcast({
        type: 'tick',
        at,
        agents: changes.agents,
        tasks: changes.tasks,
        stats: world.stats(),
      });
    }
    if (changes.activity.length) {
      // Newest first, matching the order the activity log renders in.
      broadcaster.broadcast({ type: 'activity', at, events: [...changes.activity].reverse() });
    }
    if (changes.approvals.length || changes.approvalsChanged) {
      broadcaster.broadcast({ type: 'approvals', at, approvals: repos.approvals.list() });
    }
    // Crates, creation and deletion all move the project list.
    if (changes.projectsChanged) {
      broadcaster.broadcast({ type: 'projects', at, projects: repos.projects.list() });
    }
  };

  const engine = buildEngine(repos, {
    tickMs: options.tickMs ?? config.agentTickMs,
    autoAssign: options.autoAssign ?? config.mockAutoAssign,
    onChange: publish,
  });

  const world = new WorldService(repos, engine, config.activityLimit);
  const workflow = new WorkflowService(repos);

  // Real agent execution runs beside the simulation rather than inside it: a
  // live run drives the same states the mock does, so nothing downstream —
  // the stream, the screens, the approval queue — can tell them apart.
  const execution = new TaskExecutionService(repos, {
    runners: buildAgentRunners(),
    publish,
    maxSearches: config.agentMaxSearches,
    onEvent: (event) => {
      // Progress is already reflected in the rows this service writes; the
      // event stream is for anything that has no row of its own.
      if (event.type === 'searching') {
        // eslint-disable-next-line no-console
        console.log(`[agent] search: ${event.query}`);
      }
    },
  });

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
    workflow,
    execution,
    broadcaster,
    publish,

    resetDemoData(): void {
      repos.reset();
      seedWorld(repos);
      // A reset changes everything, so send a whole snapshot rather than trying
      // to describe the delta.
      broadcaster.broadcast({ type: 'snapshot', at: Date.now(), world: world.snapshot() });
    },

    shutdown(): void {
      execution.cancelAll();
      engine.stop();
      broadcaster.closeAll();
      db.close();
    },
  };
}
