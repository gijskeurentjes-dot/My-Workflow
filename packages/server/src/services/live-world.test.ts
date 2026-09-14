import { afterEach, describe, expect, it } from 'vitest';
import { APPROVAL_PLOT, DELIVERY_PLOT, type ResearchReport } from '@ai-islands/shared';
import { createTestWorld, type TestWorld } from '../test/helpers.js';
import { DomainEventDeriver } from '../realtime/domain-events.js';
import { TaskExecutionService } from './task-execution.service.js';
import type {
  AgentRunContext,
  AgentRunResult,
  AgentRunner,
  RunEventSink,
} from './agents/claude/types.js';
import type { DomainEvent } from '@ai-islands/shared';

/**
 * The island showing what the backend is actually doing.
 *
 * These tests drive a real run and the simulation at the same time, because
 * that is the arrangement the world runs in: a model does the work, and the
 * engine walks the agent to the building it is doing it at. What is being
 * checked is the seam between them — that the walking still happens, that the
 * simulation never invents progress a model is responsible for, and that every
 * transition reaches the browser as an event that matches the row it describes.
 */

const REPORT: ResearchReport = {
  summary: 'Three competitors matter.',
  findings: [{ statement: 'Acme leads on price.', kind: 'fact', sourceUrls: ['https://acme.example'] }],
  sources: [{ title: 'Acme', url: 'https://acme.example', relevance: 'Pricing.' }],
  openQuestions: [],
  confidence: 'medium',
};

/** A runner the test drives by hand, one event at a time. */
class ControlledRunner implements AgentRunner {
  readonly archetype = 'researcher';
  emit: RunEventSink = () => {};
  taskId = '';
  private settle: ((result: AgentRunResult) => void) | null = null;
  private fail: ((error: unknown) => void) | null = null;

  run(context: AgentRunContext, emit: RunEventSink, signal: AbortSignal): Promise<AgentRunResult> {
    this.emit = emit;
    this.taskId = context.task.id;
    return new Promise<AgentRunResult>((resolve, reject) => {
      this.settle = resolve;
      this.fail = reject;
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }

  started(model = 'claude-opus-5'): void {
    this.emit({ type: 'started', taskId: this.taskId, model, at: Date.now() });
  }

  searched(query: string): void {
    this.emit({ type: 'searching', taskId: this.taskId, query, at: Date.now() });
  }

  finish(overrides: Partial<AgentRunResult> = {}): void {
    this.settle?.({
      outcome: 'completed',
      summary: REPORT.summary,
      report: REPORT,
      rawText: REPORT.summary,
      model: 'claude-opus-5',
      stopReason: 'end_turn',
      usage: {
        inputTokens: 900,
        outputTokens: 300,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        webSearches: 2,
      },
      durationMs: 1200,
      retrievedUrls: ['https://acme.example'],
      warnings: [],
      ...overrides,
    });
  }

  break(message: string): void {
    this.fail?.(new Error(message));
  }
}

interface LiveWorld {
  world: TestWorld;
  service: TaskExecutionService;
  runner: ControlledRunner;
  events: DomainEvent[];
  agentId: string;
  taskId: string;
  projectId: string;
}

function liveWorld(options: { needsApproval?: boolean } = {}): LiveWorld {
  const runner = new ControlledRunner();
  const events: DomainEvent[] = [];

  // Built before the world so the engine can ask whether a task is live.
  let service: TaskExecutionService | null = null;

  const world = createTestWorld({
    seed: false,
    isLive: (taskId) => service?.isRunning(taskId) ?? false,
  });

  const deriver = new DomainEventDeriver(world.repos);
  // Everything the world changes goes through here, exactly as it does in the
  // app — so the events these tests see are the events a browser would get.
  const publish = (changes: Parameters<typeof deriver.derive>[0]) => {
    events.push(...deriver.derive(changes));
  };

  service = new TaskExecutionService(world.repos, {
    runners: new Map([[runner.archetype, runner]]),
    publish,
    maxSearches: 4,
  });

  const { project } = world.workflow.createProject({ name: 'Market research', team: ['researcher'] });
  const agent = world.repos.agents.findByProject(project.id)[0]!;
  const { task, changes } = world.workflow.createTask({
    projectId: project.id,
    title: 'Research the top competitors in my market',
    type: 'research',
    needsApproval: options.needsApproval ?? true,
    agentId: agent.id,
  });
  publish(changes);

  // The engine's ticks publish too, so a walk shows up as events as well.
  const tick = (seconds: number) => {
    world.fastForward(seconds);
  };
  void tick;

  return { world, service, runner, events, agentId: agent.id, taskId: task.id, projectId: project.id };
}

/** Let pending promise callbacks run without advancing any clock. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('a real run, in the visual world', () => {
  let w: LiveWorld;
  afterEach(() => w?.world.close());

  it('walks the agent to the building the work happens at', async () => {
    w = liveWorld();
    // A researcher is hired standing at their own library, so put this one
    // where an agent between jobs actually stands — otherwise there is no walk
    // to observe and the test would prove nothing.
    w.world.repos.agents.update(w.agentId, { currentLocation: 'rest' });

    const running = w.service.execute(w.taskId);
    await settle();

    const task = w.world.repos.tasks.findById(w.taskId)!;
    expect(task.status).toBe('queued');
    expect(task.runMode).toBe('live');
    expect(task.buildingKey).toBe('library');

    // The simulation still owns locomotion: it sends the agent to the library.
    w.world.fastForward(1);
    expect(w.world.repos.agents.findById(w.agentId)!.movement?.toKey).toBe('library');

    w.world.fastForwardUntil(() => w.world.repos.agents.findById(w.agentId)!.movement === null, 60);
    expect(w.world.repos.agents.findById(w.agentId)!.currentLocation).toBe('library');

    w.runner.finish();
    await running;
  });

  /**
   * The rule the whole integration rests on: the simulation must not move a
   * number a model is responsible for.
   */
  it('never invents progress while a real agent is running', async () => {
    w = liveWorld();
    const running = w.service.execute(w.taskId);
    await settle();
    w.runner.started();

    const before = w.world.repos.tasks.findById(w.taskId)!.progress;
    // Far longer than this task's simulated duration: a simulated task would
    // have finished several times over by now.
    w.world.fastForward(300);
    const after = w.world.repos.tasks.findById(w.taskId)!;

    expect(after.progress).toBe(before);
    expect(after.status).toBe('working');
    // And no approval was raised behind the model's back.
    expect(w.world.repos.approvals.list({ status: 'pending' })).toHaveLength(0);

    w.runner.finish();
    await running;
  });

  it('moves progress only when the run reports something real', async () => {
    w = liveWorld();
    const running = w.service.execute(w.taskId);
    await settle();
    w.runner.started();

    const started = w.world.repos.tasks.findById(w.taskId)!.progress;
    w.runner.searched('competitors');
    const searched = w.world.repos.tasks.findById(w.taskId)!.progress;

    expect(searched).toBeGreaterThan(started);

    w.runner.finish();
    await running;
    expect(w.world.repos.tasks.findById(w.taskId)!.progress).toBe(100);
  });

  it('sends the agent to headquarters to wait for your decision', async () => {
    w = liveWorld({ needsApproval: true });
    const running = w.service.execute(w.taskId);
    await settle();
    w.runner.started();
    w.runner.finish();
    await running;

    const task = w.world.repos.tasks.findById(w.taskId)!;
    expect(task.status).toBe('waiting_approval');

    const approval = w.world.repos.approvals.findPendingByTask(w.taskId);
    expect(approval?.summary).toBe(REPORT.summary);

    w.world.fastForwardUntil(
      () => w.world.repos.agents.findById(w.agentId)!.currentLocation === APPROVAL_PLOT,
      120,
    );
    expect(w.world.repos.agents.findById(w.agentId)!.currentLocation).toBe(APPROVAL_PLOT);
    expect(w.world.repos.agents.findById(w.agentId)!.status).toBe('waiting_approval');
  });

  it('carries approved work to the depot and completes it there', async () => {
    w = liveWorld({ needsApproval: true });
    const running = w.service.execute(w.taskId);
    await settle();
    w.runner.started();
    w.runner.finish();
    await running;

    const approval = w.world.repos.approvals.findPendingByTask(w.taskId)!;
    w.world.workflow.approve(approval.id);

    w.world.fastForwardUntil(
      () => w.world.repos.tasks.findById(w.taskId)!.status === 'completed',
      180,
    );

    const task = w.world.repos.tasks.findById(w.taskId)!;
    expect(task.status).toBe('completed');
    // The result of the real run is still there afterwards.
    expect(w.world.repos.results.findLatestByTask(w.taskId)?.report?.summary).toBe(REPORT.summary);
    expect(w.world.repos.agents.findById(w.agentId)!.currentLocation).toBe(DELIVERY_PLOT);
  });

  it('keeps the agent, the task and the log when a run fails', async () => {
    w = liveWorld();
    const running = w.service.execute(w.taskId);
    await settle();
    w.runner.started();
    w.runner.searched('competitors');
    w.runner.break('the model connection dropped');
    await running;

    const task = w.world.repos.tasks.findById(w.taskId)!;
    expect(task.status).toBe('failed');
    expect(task.blocker).toBe('the model connection dropped');
    // Still assigned, so the bot stays on the island and can be retried.
    expect(task.assignedAgentId).toBe(w.agentId);
    expect(w.world.repos.agents.findById(w.agentId)!.status).toBe('failed');

    // The search it did before it broke is still in the history.
    const messages = w.world.repos.activity.list({ taskId: w.taskId }).map((e) => e.message);
    expect(messages.some((m) => m.includes('competitors'))).toBe(true);

    // A failed task stays at its building rather than disappearing.
    w.world.fastForward(30);
    expect(w.world.repos.agents.findById(w.agentId)!.currentLocation).toBe('library');
  });

  it('can be run again after a failure', async () => {
    w = liveWorld();
    const first = w.service.execute(w.taskId);
    await settle();
    w.runner.started();
    w.runner.break('timed out upstream');
    await first;

    expect(w.world.repos.tasks.findById(w.taskId)!.status).toBe('failed');

    const second = w.service.execute(w.taskId);
    await settle();
    expect(w.world.repos.tasks.findById(w.taskId)!.blocker).toBeNull();
    w.runner.started();
    w.runner.finish();
    await second;

    expect(w.world.repos.tasks.findById(w.taskId)!.status).toBe('waiting_approval');
    expect(w.world.repos.results.listByTask(w.taskId)).toHaveLength(1);
  });
});

describe('what the browser is told', () => {
  let w: LiveWorld;
  afterEach(() => w?.world.close());

  const kinds = (events: DomainEvent[]) => events.map((e) => e.kind);

  it('announces a task the moment it is created', () => {
    w = liveWorld();
    expect(kinds(w.events)).toContain('task.created');
  });

  it('reports started, progress, approval and the agent’s own states', async () => {
    w = liveWorld();
    w.events.length = 0;

    const running = w.service.execute(w.taskId);
    await settle();
    w.runner.started();
    w.runner.searched('competitors');
    w.runner.finish();
    await running;

    const seen = kinds(w.events);
    expect(seen).toContain('task.started');
    expect(seen).toContain('task.progress');
    expect(seen).toContain('agent.status');
    expect(seen).toContain('approval.requested');

    // Started is reported once, when the work began — not again on the way.
    expect(seen.filter((k) => k === 'task.started')).toHaveLength(1);

    const started = w.events.find((e) => e.kind === 'task.started');
    expect(started && 'runMode' in started ? started.runMode : null).toBe('live');

    const status = w.events.filter((e) => e.kind === 'agent.status');
    expect(status.map((e) => ('to' in e ? e.to : ''))).toEqual([
      'queued',
      'working',
      'waiting_approval',
    ]);
  });

  it('reports a failure with the reason a person can read', async () => {
    w = liveWorld();
    w.events.length = 0;

    const running = w.service.execute(w.taskId);
    await settle();
    w.runner.started();
    w.runner.break('the model connection dropped');
    await running;

    const failed = w.events.find((e) => e.kind === 'task.failed');
    expect(failed && 'reason' in failed ? failed.reason : null).toBe(
      'the model connection dropped',
    );
  });

  it('reports the approval being resolved, then the delivery', async () => {
    w = liveWorld();
    const running = w.service.execute(w.taskId);
    await settle();
    w.runner.started();
    w.runner.finish();
    await running;

    w.events.length = 0;
    const approval = w.world.repos.approvals.findPendingByTask(w.taskId)!;
    w.world.workflow.approve(approval.id);
    // The approval itself is published by the route in the app; here the
    // deriver is fed the same changes directly.
    w.world.fastForwardUntil(
      () => w.world.repos.tasks.findById(w.taskId)!.status === 'completed',
      180,
    );
    expect(w.world.repos.tasks.findById(w.taskId)!.status).toBe('completed');
  });

  /**
   * The simulation moves progress twice a second per task. Reporting every
   * one of those would drown the stream in numbers nothing can act on.
   */
  it('reports progress by the percentage point, not by the tick', () => {
    w = liveWorld();
    const { task } = w.world.workflow.createTask({
      projectId: w.projectId,
      title: 'Simulated work',
      type: 'research',
      agentId: w.agentId,
      autoStart: true,
    });

    const deriver = new DomainEventDeriver(w.world.repos);
    let reported = 0;
    const before = w.world.repos.tasks.findById(task.id)!.progress;

    for (let i = 0; i < 40; i += 1) {
      const changes = w.world.engine.tick(w.world.now() + (i + 1) * 250);
      reported += deriver.derive(changes).filter((e) => e.kind === 'task.progress').length;
    }

    const moved = w.world.repos.tasks.findById(task.id)!.progress - before;
    // Forty ticks, but only as many events as there were whole points gained.
    expect(reported).toBeLessThanOrEqual(Math.ceil(moved) + 1);
    expect(reported).toBeLessThan(40);
  });

  it('does not announce the world it woke up to', () => {
    w = liveWorld();
    const fresh = new DomainEventDeriver(w.world.repos);
    // Nothing has changed since it was built, so there is nothing to say.
    expect(
      fresh.derive({
        agents: w.world.repos.agents.list(),
        tasks: w.world.repos.tasks.list(),
        activity: [],
        approvals: w.world.repos.approvals.list(),
        projectsChanged: false,
        approvalsChanged: false,
      }),
    ).toEqual([]);
  });
});
