import {
  type ActivityEvent,
  type ActivityEventType,
  type Agent,
  type Id,
  type Project,
  type ResearchReport,
  type RunUsage,
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
import {
  RunLimitError,
  type AgentRunContext,
  type AgentRunResult,
  type AgentRunner,
  type RunEvent,
} from './agents/claude/types.js';

export interface TaskExecutionOptions {
  /** Runners by archetype. Only archetypes with one can be executed for real. */
  runners: Map<string, AgentRunner>;
  /** Called with every change so it can be broadcast. */
  publish(changes: EngineChanges): void;
  /** Called with each progress event from a running agent. */
  onEvent?(event: RunEvent): void;
  /** How many searches one run may make. */
  maxSearches?: number;
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

  /** In-flight runs, so a task can be cancelled while the model is thinking. */
  private readonly running = new Map<Id, AbortController>();

  constructor(
    private readonly repos: Repositories,
    options: TaskExecutionOptions,
  ) {
    this.runners = options.runners;
    this.publish = options.publish;
    this.onEvent = options.onEvent;
    this.maxSearches = options.maxSearches ?? RESEARCH_DEFAULTS.maxSearches;
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

    const controller = new AbortController();
    this.running.set(taskId, controller);

    // A run that overruns its own limit is aborted rather than left to finish:
    // the ceiling is the point.
    const deadline = setTimeout(() => controller.abort(), context.maxExecutionMs);

    this.markQueued(context);

    try {
      const result = await runner.run(
        context,
        (event) => this.onEvent?.(event),
        controller.signal,
      );
      return this.recordSuccess(context, result);
    } catch (error) {
      if (controller.signal.aborted) {
        // Distinguish the two ways a run stops early: you cancelled it, or it
        // ran past its ceiling. They mean different things to the reader.
        const timedOut = Date.now() - context.startedAt >= context.maxExecutionMs;
        return this.recordStopped(context, timedOut);
      }
      this.recordFailure(context, error);
      return null;
    } finally {
      clearTimeout(deadline);
      this.running.delete(taskId);
    }
  }

  /** Stop an in-flight run. Returns false if nothing was running. */
  cancel(taskId: Id): boolean {
    const controller = this.running.get(taskId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /** Stop everything. Called on shutdown. */
  cancelAll(): void {
    for (const controller of this.running.values()) controller.abort();
    this.running.clear();
  }

  // ── Preparing a run ───────────────────────────────────────────────────────

  /**
   * Resolve and validate everything a run needs, before any API call.
   *
   * Every refusal here is cheap and specific, which is the point: it is far
   * better to say "this agent asks for a tool it may not have" than to start a
   * run and discover it half-way through.
   */
  private prepare(taskId: Id): AgentRunContext & { startedAt: number } {
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

    return {
      agent,
      task,
      project,
      tools,
      model: agent.model,
      maxExecutionMs: agent.maxExecutionMs,
      maxOutputTokens: agent.maxOutputTokens,
      maxSearches: this.maxSearches,
      startedAt: Date.now(),
    };
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

  private markQueued(context: AgentRunContext & { startedAt: number }): void {
    const changes = new ChangeSet();
    const { task, agent } = context;

    changes.task(
      this.repos.tasks.update(task.id, {
        status: 'working',
        blocker: null,
        ...(task.startedAt === null ? { startedAt: context.startedAt } : {}),
      }),
    );
    changes.agent(
      this.repos.agents.update(agent.id, {
        status: 'working',
        currentTaskId: task.id,
        progress: 0,
        updatedAt: context.startedAt,
      }),
    );
    this.log(
      changes,
      'started',
      `${agent.name} started “${task.title}” on ${context.model}`,
      context,
      context.startedAt,
    );
    this.publish(changes.build());
  }

  private recordSuccess(
    context: AgentRunContext & { startedAt: number },
    result: AgentRunResult,
  ): TaskResult {
    const { task, agent } = context;
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
          this.repos.approvals.create({
            id: newId('apr'),
            taskId: task.id,
            agentId: agent.id,
            summary: result.summary,
            status: 'pending',
            requestedAt: now,
            decidedAt: null,
            note: null,
          }),
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
    context: AgentRunContext & { startedAt: number },
    timedOut: boolean,
  ): null {
    const { task, agent } = context;
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
    context: AgentRunContext & { startedAt: number },
    error: unknown,
  ): void {
    const { task, agent } = context;
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
