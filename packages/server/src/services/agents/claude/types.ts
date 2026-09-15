import type {
  Agent,
  Project,
  ProposedAction,
  ResearchReport,
  RunUsage,
  Task,
} from '@ai-islands/shared';

/**
 * Everything one run needs, resolved before the model is called.
 *
 * Assembling this up front is what makes project scope enforceable: the
 * executor is handed exactly one project and one task, and has no way to reach
 * a second one even if the model asks.
 */
export interface AgentRunContext {
  agent: Agent;
  task: Task;
  project: Project;
  /** Resolved tool allow-list, already checked against the forbidden list. */
  tools: string[];
  model: string;
  maxExecutionMs: number;
  maxOutputTokens: number;
  maxSearches: number;
  /**
   * Ask a person before doing something gated, and wait for the answer.
   *
   * The only route to an action with an effect outside the work itself. It
   * resolves with the decision rather than throwing, because being refused is
   * a normal thing that happens to an agent: the run is expected to carry on
   * without having done it, and say so.
   *
   * While it is pending the run is genuinely stopped — no tokens, no tool
   * calls — and the execution ceiling is paused.
   */
  requestApproval(action: ProposedAction): Promise<'approved' | 'rejected' | 'cancelled'>;
}

/** Progress reported while a run is in flight. */
export type RunEvent =
  | { type: 'queued'; taskId: string; at: number }
  | { type: 'started'; taskId: string; model: string; at: number }
  | { type: 'searching'; taskId: string; query: string; at: number }
  | { type: 'thinking'; taskId: string; at: number }
  | { type: 'text'; taskId: string; delta: string; at: number }
  | { type: 'structuring'; taskId: string; at: number }
  | { type: 'finished'; taskId: string; usage: RunUsage; at: number }
  | { type: 'failed'; taskId: string; reason: string; at: number }
  | { type: 'cancelled'; taskId: string; at: number };

export type RunEventSink = (event: RunEvent) => void;

/** What a completed run produced. */
export interface AgentRunResult {
  outcome: 'completed' | 'refused';
  summary: string;
  report: ResearchReport | null;
  rawText: string;
  model: string;
  stopReason: string | null;
  usage: RunUsage;
  durationMs: number;
  /** URLs the run actually retrieved, used to check the report's honesty. */
  retrievedUrls: string[];
  /**
   * Anything the run got wrong that is worth surfacing without failing it —
   * for instance a source cited that was never actually fetched.
   */
  warnings: string[];
}

/**
 * The seam every real agent implements.
 *
 * One method, because a run is one thing: given a resolved context, do the work
 * or throw. Cancellation arrives through the signal rather than a second
 * method, so it composes with the SDK's own abort handling.
 */
export interface AgentRunner {
  readonly archetype: string;
  run(
    context: AgentRunContext,
    emit: RunEventSink,
    signal: AbortSignal,
  ): Promise<AgentRunResult>;
}

/** Raised when a run breaks one of its own limits. */
export class RunLimitError extends Error {
  constructor(
    message: string,
    readonly limit: 'time' | 'tokens' | 'searches',
  ) {
    super(message);
    this.name = 'RunLimitError';
  }
}

export type { ResearchReport, RunUsage };
