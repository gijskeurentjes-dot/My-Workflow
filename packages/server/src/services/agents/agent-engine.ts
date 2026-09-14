import type {
  ActivityEvent,
  ApprovalRequest,
  Bot,
  EngineInfo,
  Task,
} from '@ai-islands/shared';

/**
 * What an agent engine has to provide.
 *
 * `MockAgentEngine` implements this today with a local state machine. A future
 * `ClaudeAgentEngine` implements the same interface by calling real agents —
 * the routes, the SSE stream and every screen stay exactly as they are, because
 * all of them consume `EngineChanges`, not the engine's internals.
 */
export interface AgentEngine {
  /** Identifies the implementation to the UI: 'mock', later 'claude'. */
  readonly kind: string;

  /** Begin advancing the world on a timer. */
  start(): void;

  /** Stop the timer. Safe to call when already stopped. */
  stop(): void;

  /**
   * Advance the world once and report what changed.
   *
   * Exposed separately from `start` so tests can step deterministically and so
   * a future engine can be driven by agent callbacks instead of a clock.
   */
  tick(now?: number): EngineChanges;

  info(): EngineInfo;
}

/**
 * Everything one tick changed. Only rows that actually moved are included, so
 * the SSE stream stays small even as the world grows.
 */
export interface EngineChanges {
  bots: Bot[];
  tasks: Task[];
  activity: ActivityEvent[];
  approvals: ApprovalRequest[];
  /** True when a crate was delivered and an island's count went up. */
  islandsChanged: boolean;
  /** True when a project was created, edited or deleted. */
  projectsChanged: boolean;
  /**
   * True when the approval queue changed in a way no row in `approvals`
   * describes — a request that was withdrawn, or deleted with its task.
   */
  approvalsChanged: boolean;
}

export const NO_CHANGES: EngineChanges = Object.freeze({
  bots: [],
  tasks: [],
  activity: [],
  approvals: [],
  islandsChanged: false,
  projectsChanged: false,
  approvalsChanged: false,
});

export const hasChanges = (c: EngineChanges): boolean =>
  c.bots.length > 0 ||
  c.tasks.length > 0 ||
  c.activity.length > 0 ||
  c.approvals.length > 0 ||
  c.islandsChanged ||
  c.projectsChanged ||
  c.approvalsChanged;

/**
 * Accumulates a tick's changes, keeping one entry per row so a bot touched
 * three times in one tick is still broadcast once, in its final state.
 */
export class ChangeSet {
  private readonly botMap = new Map<string, Bot>();
  private readonly taskMap = new Map<string, Task>();
  private readonly approvalMap = new Map<string, ApprovalRequest>();
  private readonly events: ActivityEvent[] = [];
  private islandsTouched = false;
  private projectsTouched = false;
  private approvalsTouched = false;

  bot(bot: Bot | null): void {
    if (bot) this.botMap.set(bot.id, bot);
  }

  task(task: Task | null): void {
    if (task) this.taskMap.set(task.id, task);
  }

  approval(approval: ApprovalRequest | null): void {
    if (approval) this.approvalMap.set(approval.id, approval);
  }

  activity(event: ActivityEvent): void {
    this.events.push(event);
  }

  islands(): void {
    this.islandsTouched = true;
  }

  projects(): void {
    this.projectsTouched = true;
  }

  /** Mark the queue dirty when a request vanished rather than changed. */
  approvalsDirty(): void {
    this.approvalsTouched = true;
  }

  build(): EngineChanges {
    return {
      bots: [...this.botMap.values()],
      tasks: [...this.taskMap.values()],
      approvals: [...this.approvalMap.values()],
      activity: this.events,
      islandsChanged: this.islandsTouched,
      projectsChanged: this.projectsTouched,
      approvalsChanged: this.approvalsTouched,
    };
  }
}
