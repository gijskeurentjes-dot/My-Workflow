import {
  APPROVAL_CATEGORIES,
  buildApprovalRequest,
  type ActivityEvent,
  type ActivityEventType,
  type Agent,
  type Id,
  type Project,
  type ResearchReport,
  type RunUsage,
  type ProposedAction,
  type Task,
  type TaskResult,
} from '@ai-islands/shared';
import { invalid, notFound, refuse } from '../errors.js';
import { newId } from '../ids.js';
import type { Repositories } from '../repositories/types.js';
import { ChangeSet, type EngineChanges } from './agents/agent-engine.js';
import {
  FORBIDDEN_TOOLS,
  RESEARCH_DEFAULTS,
  isLiveArchetype,
} from './agents/claude/nova.js';
import { ApprovalGateRegistry, type ApprovalOutcome } from './approval-gates.js';
import { permissions, type ActionRequest } from './permissions.service.js';
import {
  RunLimitError,
  type AgentRunContext,
  type AgentRunResult,
  type AgentRunner,
  type RunEvent,
} from './agents/claude/types.js';

/** A resolved context plus the bookkeeping one run needs while it is going. */
interface RunContext extends AgentRunContext {
  startedAt: number;
  /** How many searches have actually been made, counted as they happen. */
  searches: number;
}

/**
 * One in-flight run.
 *
 * The execution ceiling is held here rather than as a plain timer because it
 * has to be **paused** while the run is stopped at an approval gate: a person
 * taking twenty minutes to read a request is not the agent overrunning, and
 * killing the run because they went to lunch would make the gate useless.
 */
interface RunHandle {
  controller: AbortController;
  timer: NodeJS.Timeout | null;
  /** Execution time left, excluding anything spent waiting for a person. */
  remainingMs: number;
  /** When the clock was last started. Null while paused at a gate. */
  runningSince: number | null;
  /** Set when the ceiling actually fired, so a timeout is never guessed at. */
  timedOut: boolean;
  /** Total time spent waiting for a decision, for the record. */
  waitedMs: number;
}

/**
 * The phases a research run passes through, as progress.
 *
 * These are not a guess at elapsed time — nothing can know how long a run has
 * left. They are the milestones the run actually reports: it started, it
 * searched n times, it is writing up. The bar only ever says what has happened.
 */
const STARTED_PROGRESS = 5;
const SEARCH_CEILING = 70;
const STRUCTURING_PROGRESS = 88;

const searchProgress = (searches: number, maxSearches: number): number =>
  STARTED_PROGRESS +
  (SEARCH_CEILING - STARTED_PROGRESS) * Math.min(1, searches / Math.max(1, maxSearches));

export interface TaskExecutionOptions {
  /** Runners by archetype. Only archetypes with one can be executed for real. */
  runners: Map<string, AgentRunner>;
  /** Called with every change so it can be broadcast. */
  publish(changes: EngineChanges): void;
  /** Called with each progress event from a running agent. */
  onEvent?(event: RunEvent): void;
  /** How many searches one run may make. */
  maxSearches?: number;
  /**
   * Where runs wait for a person. Shared with the workflow service, which is
   * what turns your decision into the run resuming.
   */
  gates?: ApprovalGateRegistry;
}

/**
 * Runs a task against a real agent.
 *
 * This is the orchestration the brief asks for: take a task id, load the task,
 * its agent and its project, check the run is allowed, execute it, stream
 * progress, save the result, and leave the world in a defensible state whether
 * it succeeded, failed, was refused or was cancelled.
 *
 * It deliberately does not touch the simulation engine. A task being executed
 * for real is `queued` then `working` then `waiting_approval` or `completed` —
 * the same states the mock drives, so nothing downstream can tell the
 * difference.
 */
export class TaskExecutionService {
  private readonly runners: Map<string, AgentRunner>;
  private readonly publish: (changes: EngineChanges) => void;
  private readonly onEvent: ((event: RunEvent) => void) | undefined;
  private readonly maxSearches: number;
  readonly gates: ApprovalGateRegistry;

  /** In-flight runs, so a task can be cancelled while the model is thinking. */
  private readonly running = new Map<Id, RunHandle>();

  constructor(
    private readonly repos: Repositories,
    options: TaskExecutionOptions,
  ) {
    this.runners = options.runners;
    this.publish = options.publish;
    this.onEvent = options.onEvent;
    this.maxSearches = options.maxSearches ?? RESEARCH_DEFAULTS.maxSearches;
    this.gates = options.gates ?? new ApprovalGateRegistry();
  }

  /** True when this task could be executed by a real agent right now. */
  canExecute(taskId: Id): boolean {
    const task = this.repos.tasks.findById(taskId);
    if (!task?.assignedAgentId) return false;
    const agent = this.repos.agents.findById(task.assignedAgentId);
    return agent ? this.runners.has(agent.archetype) : false;
  }

  isRunning(taskId: Id): boolean {
    return this.running.has(taskId);
  }

  /**
   * Execute one task, start to finish.
   *
   * Resolves when the run is over, whatever the outcome. It never throws for an
   * ordinary failure — a failed run is a task in the `failed` state with a
   * blocker you can read, which is more useful than an exception nobody sees.
   */
  async execute(taskId: Id): Promise<TaskResult | null> {
    const context = this.prepare(taskId);
    const runner = this.runners.get(context.agent.archetype);
    if (!runner) {
      throw refuse(
        `No live engine for a ${context.agent.archetype}. Only a Researcher can be executed for real today.`,
      );
    }

    const handle: RunHandle = {
      controller: new AbortController(),
      timer: null,
      remainingMs: context.maxExecutionMs,
      runningSince: null,
      timedOut: false,
      waitedMs: 0,
    };
    this.running.set(taskId, handle);
    // A run that overruns its own limit is aborted rather than left to finish:
    // the ceiling is the point.
    this.startClock(handle);

    this.markQueued(context);

    try {
      const result = await runner.run(
        context,
        (event) => this.onRunEvent(context, event),
        handle.controller.signal,
      );
      return this.recordSuccess(context, result);
    } catch (error) {
      if (handle.controller.signal.aborted) {
        // The two ways a run stops early mean different things to the reader,
        // and the ceiling records which one happened rather than being inferred
        // from a clock that pauses at every gate.
        return this.recordStopped(context, handle.timedOut);
      }
      this.recordFailure(context, error);
      return null;
    } finally {
      this.stopClock(handle);
      this.withdrawGateFor(taskId, 'The run ended.');
      this.running.delete(taskId);
    }
  }

  // ── The execution ceiling ─────────────────────────────────────────────────

  private startClock(handle: RunHandle): void {
    if (handle.timer || handle.remainingMs <= 0) return;
    handle.runningSince = Date.now();
    handle.timer = setTimeout(() => {
      handle.timedOut = true;
      handle.controller.abort();
    }, handle.remainingMs);
  }

  private pauseClock(handle: RunHandle): void {
    if (!handle.timer) return;
    clearTimeout(handle.timer);
    handle.timer = null;
    if (handle.runningSince !== null) {
      handle.remainingMs = Math.max(0, handle.remainingMs - (Date.now() - handle.runningSince));
      handle.runningSince = null;
    }
  }

  private stopClock(handle: RunHandle): void {
    if (handle.timer) clearTimeout(handle.timer);
    handle.timer = null;
    handle.runningSince = null;
  }

  /**
   * Turn a runner's progress into rows the world can show.
   *
   * This is the join between a model doing something and an island showing it.
   * Nothing here invents state: the agent is marked working when the run
   * actually starts, and every number written is a count of something that
   * happened — a search that was made, a phase that was reached.
   */
  private onRunEvent(context: RunContext, event: RunEvent): void {
    switch (event.type) {
      case 'started':
        // Queued until now. "Working" appears on screen at the moment the
        // model call begins, and not a moment before it.
        this.markWorking(context);
        break;

      case 'searching': {
        context.searches += 1;
        this.markProgress(
          context,
          searchProgress(context.searches, context.maxSearches),
          'progress',
          `${context.agent.name} searched the web for “${event.query}”`,
        );
        break;
      }

      case 'structuring':
        this.markProgress(context, STRUCTURING_PROGRESS, null, null);
        break;

      default:
        break;
    }

    this.onEvent?.(event);
  }

  /** Stop an in-flight run. Returns false if nothing was running. */
  cancel(taskId: Id): boolean {
    const handle = this.running.get(taskId);
    if (!handle) return false;
    // A run stopped at a gate is waiting on a promise, not on the model, so
    // releasing the gate is what actually lets it unwind.
    this.gates.cancelForTask(taskId);
    handle.controller.abort();
    return true;
  }

  /** True while this run is stopped, waiting for a person to decide. */
  isWaitingForApproval(taskId: Id): boolean {
    return this.gates.openForTask(taskId) !== null;
  }

  /** Stop everything. Called on shutdown. */
  cancelAll(): void {
    this.gates.cancelAll();
    for (const handle of this.running.values()) handle.controller.abort();
    this.running.clear();
  }

  // ── Asking before acting ──────────────────────────────────────────────────

  /**
   * Stop, ask, and wait.
   *
   * This is the gate. An agent that wants to do something gated calls it and
   * genuinely stops: the request appears in your queue, the agent stands at the
   * Approval Post, and nothing else happens until you answer. The execution
   * ceiling is paused while it waits, because time spent reading a request is
   * not time the agent spent working.
   *
   * It returns your answer rather than throwing, so a runner has to *handle*
   * a refusal — standing down is a normal outcome, not an error.
   */
  private async requestApproval(
    context: RunContext,
    proposed: ProposedAction,
  ): Promise<ApprovalOutcome> {
    const handle = this.running.get(context.task.id);
    if (!handle) return 'cancelled';

    // Checked again here, at the last moment before the request is raised: a
    // run may not ask for permission to do something no approval could grant.
    const verdict = permissions.check({
      agent: context.agent,
      project: context.project,
      task: context.task,
      action: {
        ...(proposed.category ? { category: proposed.category } : {}),
        files: proposed.files,
      } satisfies ActionRequest,
    });
    if (verdict.decision === 'deny') {
      this.recordDenied(context, proposed, verdict.reason);
      return 'rejected';
    }

    const now = Date.now();
    const request = buildApprovalRequest({
      id: newId('apr'),
      taskId: context.task.id,
      agentId: context.agent.id,
      summary: proposed.action,
      category: proposed.category,
      action: proposed.action,
      reason: proposed.reason,
      tools: proposed.tools,
      impact: proposed.impact,
      files: proposed.files,
      ...(proposed.risk ? { risk: proposed.risk } : {}),
      // The distinguishing fact: a run is stopped on this one.
      blocking: true,
      requestedAt: now,
    });

    const changes = new ChangeSet();
    changes.approval(this.repos.approvals.create(request));
    changes.task(this.repos.tasks.update(context.task.id, { status: 'waiting_approval' }));
    changes.agent(
      this.repos.agents.update(context.agent.id, { status: 'waiting_approval', updatedAt: now }),
    );
    this.log(
      changes,
      'approval_requested',
      `${context.agent.name} is asking before ${lowerFirst(proposed.action)} — ${APPROVAL_CATEGORIES[proposed.category].label.toLowerCase()}`,
      context,
      now,
    );
    this.publish(changes.build());

    // The clock stops here and starts again below: waiting on a person costs
    // the run nothing.
    this.pauseClock(handle);
    const outcome = await this.gates.wait(request.id, context.task.id, context.agent.id);
    handle.waitedMs += Date.now() - now;

    if (outcome === 'approved') {
      this.resumeAfterApproval(context, request.action);
      this.startClock(handle);
      return 'approved';
    }

    if (outcome === 'rejected') {
      // Refused: the agent carries on without doing it, and the refusal is on
      // the record whether or not the run mentions it again.
      const resumed = new ChangeSet();
      resumed.task(this.repos.tasks.update(context.task.id, { status: 'working' }));
      resumed.agent(
        this.repos.agents.update(context.agent.id, { status: 'working', updatedAt: Date.now() }),
      );
      this.log(
        resumed,
        'rejected',
        `You refused: ${context.agent.name} will not ${lowerFirst(request.action)}`,
        context,
        Date.now(),
      );
      this.publish(resumed.build());
      this.startClock(handle);
      return 'rejected';
    }

    // Cancelled: the work itself was called off. The run is aborted, and
    // whatever it was about to do never happens.
    handle.controller.abort();
    return 'cancelled';
  }

  /** Back to work, with the thing you agreed to now permitted. */
  private resumeAfterApproval(context: RunContext, action: string): void {
    const now = Date.now();
    const changes = new ChangeSet();
    changes.task(this.repos.tasks.update(context.task.id, { status: 'working' }));
    changes.agent(
      this.repos.agents.update(context.agent.id, { status: 'working', updatedAt: now }),
    );
    this.log(
      changes,
      'approved',
      `You approved: ${context.agent.name} is ${lowerFirst(action)}`,
      context,
      now,
    );
    this.publish(changes.build());
  }

  /** An action no approval could have permitted. Recorded, then refused. */
  private recordDenied(context: RunContext, proposed: ProposedAction, reason: string): void {
    const changes = new ChangeSet();
    this.log(
      changes,
      'blocked',
      `${context.agent.name} was refused: ${proposed.action}. ${reason}`,
      context,
      Date.now(),
    );
    this.publish(changes.build());
  }

  /**
   * Close any question this run left hanging.
   *
   * Asked from the `finally` of every run, because a request nobody can answer
   * any more is worse than no request at all: it sits in the queue offering
   * buttons that would do nothing. Only *blocking* requests are withdrawn — a
   * finished deliverable waiting for sign-off is exactly what should survive
   * the run that produced it.
   */
  private withdrawGateFor(taskId: Id, reason: string): void {
    this.gates.cancelForTask(taskId);

    const stranded = this.repos.approvals
      .list({ status: 'pending' })
      .filter((a) => a.taskId === taskId && a.blocking);
    if (stranded.length === 0) return;

    const changes = new ChangeSet();
    for (const request of stranded) {
      changes.approval(this.repos.approvals.decide(request.id, 'cancelled', reason));
    }
    changes.approvalsDirty();
    this.publish(changes.build());
  }

  // ── Preparing a run ───────────────────────────────────────────────────────

  /**
   * Resolve and validate everything a run needs, before any API call.
   *
   * Every refusal here is cheap and specific, which is the point: it is far
   * better to say "this agent asks for a tool it may not have" than to start a
   * run and discover it half-way through.
   */
  private prepare(taskId: Id): RunContext {
    const task = this.repos.tasks.findById(taskId);
    if (!task) throw notFound('Task');

    if (!task.assignedAgentId) {
      throw refuse('Assign an agent before running this task.');
    }
    if (task.status === 'working' || task.status === 'queued') {
      throw refuse('That task is already running.');
    }
    if (task.status === 'completed' || task.status === 'cancelled') {
      throw refuse(`That task is ${task.status}.`);
    }
    if (this.running.has(taskId)) {
      throw refuse('That task is already running.');
    }

    const agent = this.repos.agents.findById(task.assignedAgentId);
    if (!agent) throw notFound('Agent');

    // One agent, one job. Starting a run for someone who is part-way through
    // something else would leave two tasks pointing at one bot, and the world
    // can only draw it in one place.
    if (agent.currentTaskId && agent.currentTaskId !== task.id) {
      const held = this.repos.tasks.findById(agent.currentTaskId);
      throw refuse(
        held
          ? `${agent.name} is already on “${held.title}”. Finish or reassign that first.`
          : `${agent.name} is already busy.`,
      );
    }

    if (!isLiveArchetype(agent.archetype)) {
      throw refuse(
        `${agent.name} is a ${agent.role || agent.archetype} — only a Researcher has a live engine today.`,
      );
    }

    const project = this.repos.projects.findById(task.projectId);
    if (!project) throw notFound('Project');

    // Project scope, enforced rather than trusted: an agent may only run work
    // belonging to the project it is on.
    if (agent.projectId !== project.id) {
      throw refuse(
        `${agent.name} is not on ${project.name}, so cannot run its work. Assign or transfer them first.`,
      );
    }

    const tools = this.resolveTools(agent);

    const context: RunContext = {
      agent,
      task,
      project,
      tools,
      model: agent.model,
      maxExecutionMs: agent.maxExecutionMs,
      maxOutputTokens: agent.maxOutputTokens,
      maxSearches: this.maxSearches,
      startedAt: Date.now(),
      searches: 0,
      // The runner's only way to do something gated: ask, and wait. Bound to
      // this context so a runner cannot ask on behalf of another task.
      requestApproval: (proposed: ProposedAction) => this.requestApproval(context, proposed),
    };

    return context;
  }

  /**
   * Check the agent's stored tool list against what is permitted.
   *
   * The stored brief is editable, so it is not trusted: a forbidden tool is a
   * hard refusal, and an unrecognised one is dropped rather than guessed at.
   */
  private resolveTools(agent: Agent): string[] {
    const normalise = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');
    const forbidden = new Set(FORBIDDEN_TOOLS.map(normalise));

    for (const tool of agent.tools) {
      if (forbidden.has(normalise(tool))) {
        throw invalid(
          `${agent.name} lists the tool “${tool}”, which no agent may use in this build. Remove it from their brief before running.`,
        );
      }
    }

    // A researcher searches the web. Everything else in the brief is a label
    // for a human, not a capability, so it is not handed to the model.
    return ['web_search'];
  }

  // ── Recording what happened ───────────────────────────────────────────────

  /**
   * Accept the work, before anything has been asked of the model.
   *
   * The task is `queued`, not `working`: the world must never show an agent
   * working until the backend reports that it is, and at this point the run has
   * not begun. `runMode` is set here so every screen knows, from the first
   * frame, that these numbers will come from a real run rather than the clock.
   */
  private markQueued(context: RunContext): void {
    const changes = new ChangeSet();
    const { task, agent } = context;

    changes.task(
      this.repos.tasks.update(task.id, {
        status: 'queued',
        runMode: 'live',
        progress: 0,
        blocker: null,
        ...(task.startedAt === null ? { startedAt: context.startedAt } : {}),
      }),
    );
    changes.agent(
      this.repos.agents.update(agent.id, {
        status: 'queued',
        currentTaskId: task.id,
        progress: 0,
        updatedAt: context.startedAt,
      }),
    );
    this.log(
      changes,
      'queued',
      `${agent.name} accepted “${task.title}” — starting on ${context.model}`,
      context,
      context.startedAt,
    );
    this.publish(changes.build());
  }

  /** The model call has begun. Only now is the agent actually working. */
  private markWorking(context: RunContext): void {
    const now = Date.now();
    const changes = new ChangeSet();
    const { task, agent } = context;

    changes.task(
      this.repos.tasks.update(task.id, { status: 'working', progress: STARTED_PROGRESS }),
    );
    changes.agent(
      this.repos.agents.update(agent.id, {
        status: 'working',
        progress: STARTED_PROGRESS,
        updatedAt: now,
      }),
    );
    this.log(
      changes,
      'started',
      `${agent.name} started working on “${task.title}”`,
      context,
      now,
    );
    this.publish(changes.build());
  }

  /**
   * Move progress forward, never back.
   *
   * A research run cannot report a percentage of itself honestly — nothing
   * knows how many searches are left. So this is a count of phases reached, and
   * it is monotonic: what the bar says has happened, has happened.
   */
  private markProgress(
    context: RunContext,
    progress: number,
    eventType: ActivityEventType | null,
    message: string | null,
  ): void {
    const now = Date.now();
    const current = this.repos.tasks.findById(context.task.id);
    if (!current || current.status !== 'working') return;

    const next = Math.max(current.progress, progress);
    const changes = new ChangeSet();
    changes.task(this.repos.tasks.update(context.task.id, { progress: next }));
    changes.agent(
      this.repos.agents.update(context.agent.id, { progress: next, updatedAt: now }),
    );
    if (eventType && message) this.log(changes, eventType, message, context, now);
    this.publish(changes.build());
  }

  private recordSuccess(
    context: RunContext,
    result: AgentRunResult,
  ): TaskResult | null {
    const { task, agent } = context;
    // The task can be deleted while the model is still thinking. There is then
    // nothing to attach the answer to, and nothing worth failing over.
    if (!this.repos.tasks.findById(task.id)) return null;
    const now = Date.now();

    const stored = this.repos.transaction(() => {
      const saved = this.repos.results.create({
        id: newId('res'),
        taskId: task.id,
        agentId: agent.id,
        summary: result.summary,
        report: result.report,
        rawText: result.rawText,
        model: result.model,
        stopReason: result.stopReason,
        usage: result.usage,
        durationMs: result.durationMs,
        createdAt: now,
      });

      const changes = new ChangeSet();

      if (result.outcome === 'refused') {
        // A decline is a blocker you can act on, not a crash.
        changes.task(
          this.repos.tasks.update(task.id, { status: 'failed', blocker: result.summary }),
        );
        changes.agent(
          this.repos.agents.update(agent.id, { status: 'failed', updatedAt: now }),
        );
        this.log(changes, 'blocked', `${agent.name} was declined: ${result.summary}`, context, now);
        this.publish(changes.build());
        return saved;
      }

      // Finished work either waits for your sign-off or goes straight out.
      const needsApproval = task.needsApproval || agent.requiresApproval;

      changes.task(
        this.repos.tasks.update(task.id, {
          status: needsApproval ? 'waiting_approval' : 'delivering',
          progress: 100,
        }),
      );
      changes.agent(
        this.repos.agents.update(agent.id, {
          status: needsApproval ? 'waiting_approval' : 'working',
          progress: 100,
          updatedAt: now,
        }),
      );

      if (needsApproval) {
        changes.approval(
          this.repos.approvals.create(
            buildApprovalRequest({
              id: newId('apr'),
              taskId: task.id,
              agentId: agent.id,
              summary: result.summary,
              category: 'deliverable',
              action: `Deliver ${agent.name}’s result for “${task.title}”`,
              reason: `${agent.name} finished the run on ${result.model}. This work needs your sign-off before it is delivered.`,
              tools: context.tools,
              impact:
                'Approving delivers the result and completes the task. Sending it back reopens the work with your note.',
              requestedAt: now,
            }),
          ),
        );
        this.log(
          changes,
          'approval_requested',
          `${agent.name} finished “${task.title}” and is waiting for your approval`,
          context,
          now,
        );
      } else {
        this.log(changes, 'progress', `${agent.name} finished “${task.title}”`, context, now);
      }

      // Warnings are recorded as their own log lines so an over-claimed source
      // is visible in the history rather than buried in the report.
      for (const warning of result.warnings) {
        this.log(changes, 'system', `${agent.name}: ${warning}`, context, now);
      }

      this.publish(changes.build());
      return saved;
    });

    return stored;
  }

  private recordStopped(
    context: RunContext,
    timedOut: boolean,
  ): null {
    const { task, agent } = context;
    if (!this.repos.tasks.findById(task.id)) return null;
    const now = Date.now();
    const changes = new ChangeSet();

    const reason = timedOut
      ? `The run passed its ${Math.round(context.maxExecutionMs / 1000)}s limit and was stopped.`
      : 'The run was cancelled.';

    changes.task(
      this.repos.tasks.update(task.id, {
        status: timedOut ? 'failed' : 'cancelled',
        ...(timedOut ? { blocker: reason } : { assignedAgentId: null }),
      }),
    );
    changes.agent(
      this.repos.agents.update(agent.id, {
        status: timedOut ? 'failed' : 'idle',
        ...(timedOut ? {} : { currentTaskId: null, progress: 0 }),
        updatedAt: now,
      }),
    );
    this.log(changes, timedOut ? 'blocked' : 'cancelled', `${agent.name}: ${reason}`, context, now);
    this.publish(changes.build());
    return null;
  }

  private recordFailure(
    context: RunContext,
    error: unknown,
  ): void {
    const { task, agent } = context;
    if (!this.repos.tasks.findById(task.id)) return;
    const now = Date.now();
    const changes = new ChangeSet();
    const reason = describeFailure(error);

    changes.task(this.repos.tasks.update(task.id, { status: 'failed', blocker: reason }));
    changes.agent(this.repos.agents.update(agent.id, { status: 'failed', updatedAt: now }));
    this.log(changes, 'blocked', `${agent.name} could not finish “${task.title}”: ${reason}`, context, now);
    this.publish(changes.build());
  }

  private log(
    changes: ChangeSet,
    eventType: ActivityEventType,
    message: string,
    context: { task: Task; agent: Agent; project: Project },
    at: number,
  ): void {
    const event: ActivityEvent = {
      id: newId('evt'),
      projectId: context.project.id,
      agentId: context.agent.id,
      taskId: context.task.id,
      eventType,
      message,
      timestamp: at,
    };
    this.repos.activity.create(event);
    changes.activity(event);
  }
}

/** "Send the pack" → "send the pack", for use mid-sentence. */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Turn a thrown thing into a sentence worth putting in front of a person.
 *
 * The SDK's typed errors are checked most-specific first; an API key problem
 * and a rate limit need very different responses from the reader, and neither
 * is helped by a stack trace in a blocker field.
 */
export function describeFailure(error: unknown): string {
  if (error instanceof RunLimitError) return error.message;

  if (error instanceof Error) {
    const name = error.constructor.name;
    if (name === 'AuthenticationError') {
      return 'The API rejected the credentials. Check ANTHROPIC_API_KEY.';
    }
    if (name === 'RateLimitError') {
      return 'The API is rate limiting this key. Try again shortly.';
    }
    if (name === 'BadRequestError') {
      return `The API rejected the request: ${error.message}`;
    }
    if (name === 'APIConnectionError') {
      return 'Could not reach the API. Check the network and try again.';
    }
    return error.message;
  }

  return 'The run failed for an unknown reason.';
}

export type { ResearchReport, RunUsage };
