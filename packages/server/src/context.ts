import { config } from './config.js';
import { isEmptyWorld, seedWorld } from './db/seed.js';
import { openDatabase, type Db } from './db/sqlite.js';
import { createSqliteRepositories } from './repositories/sqlite/index.js';
import type { Repositories } from './repositories/types.js';
import { Broadcaster } from './realtime/broadcaster.js';
import { DomainEventDeriver } from './realtime/domain-events.js';
import { reconcileAgentStates, recoverInterruptedRuns } from './services/recovery.js';
import type { AgentEngine, EngineChanges } from './services/agents/agent-engine.js';
import { MockAgentEngine } from './services/agents/mock-agent-engine.js';
import { WorldService } from './services/world.service.js';
import { WorkflowService } from './services/workflow.service.js';
import { TaskExecutionService } from './services/task-execution.service.js';
import { buildAgentRunners, runtimeInfo } from './services/agents/claude/runners.js';

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
  options: {
    tickMs: number;
    autoAssign: boolean;
    isLive: (taskId: string) => boolean;
    onChange: (c: EngineChanges) => void;
  },
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
  const domainEvents = new DomainEventDeriver(repos);

  /**
   * Set once the execution service exists, so the engine can ask whether a
   * task is being run for real. The two are mutually referential — the engine
   * must not simulate a live task, and a live run relies on the engine to walk
   * its agent about — and this is the smaller of the two knots to tie.
   */
  let execution: TaskExecutionService | null = null;

  /**
   * Turn a set of changes into stream events.
   *
   * Declared before the engine so both the engine's ticks and the workflow
   * service's commands can hand changes to the same function.
   */
  const publish = (changes: EngineChanges): void => {
    const at = Date.now();

    // Derived before anything is sent, so the named events and the rows they
    // describe are always in the same batch.
    const events = domainEvents.derive(changes);

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
    if (events.length) {
      broadcaster.broadcast({ type: 'events', at, events });
    }
  };

  const engine = buildEngine(repos, {
    tickMs: options.tickMs ?? config.agentTickMs,
    autoAssign: options.autoAssign ?? config.mockAutoAssign,
    // The simulation keeps walking a live agent about, but never touches the
    // progress of work a real model is doing.
    isLive: (taskId) => execution?.isRunning(taskId) ?? false,
    onChange: publish,
  });

  const world = new WorldService(repos, engine, config.activityLimit, runtimeInfo);
  const workflow = new WorkflowService(repos);

  // Real agent execution runs beside the simulation rather than inside it: a
  // live run drives the same states the mock does, so nothing downstream —
  // the stream, the screens, the approval queue — can tell them apart.
  execution = new TaskExecutionService(repos, {
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

  // Deciding an approval is what releases a run stopped at a gate, so both
  // services work from the same registry.
  workflow.useGates(execution.gates);

  if (options.seed !== false && isEmptyWorld(repos)) {
    seedWorld(repos);
  }

  // A run stopped at a gate cannot survive a restart: the promise it was
  // waiting on was in memory. Anything left pending belongs to a run that is
  // gone, so it is withdrawn and its task is marked failed — nothing was done
  // without approval, and Retry runs it again.
  recoverInterruptedRuns(repos);

  // And make sure every agent's status still describes the work it is holding.
  // A world that says an agent is waiting on a decision that does not exist is
  // worse than one that says nothing.
  reconcileAgentStates(repos);

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
      execution?.cancelAll();
      repos.reset();
      seedWorld(repos);
      // The new world is the baseline, not a burst of "everything was created".
      domainEvents.seed();
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
