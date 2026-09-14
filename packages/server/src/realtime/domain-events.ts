import type {
  AgentStatus,
  ApprovalStatus,
  DomainEvent,
  TaskStatus,
} from '@ai-islands/shared';
import type { Repositories } from '../repositories/types.js';
import type { EngineChanges } from '../services/agents/agent-engine.js';

/**
 * Turns changed rows into named events: what happened, not what is now true.
 *
 * Deriving them here rather than emitting them from each transition is a
 * deliberate choice. Every change to the world — a simulated tick, a real
 * agent's run, a button you pressed — reaches the browser through one
 * `publish`, so deriving at that point means an event cannot be forgotten at a
 * call site, cannot disagree with the row it describes, and does not care which
 * engine produced it. The cost is remembering the previous value of a handful
 * of fields, which is what this class is.
 *
 * Entries for deleted rows are left behind: ids are never reused, so a stale
 * entry can only be read by a row that no longer exists. `seed()` clears them.
 */
export class DomainEventDeriver {
  private readonly agentStatus = new Map<string, AgentStatus>();
  private readonly taskStatus = new Map<string, TaskStatus>();
  private readonly taskProgress = new Map<string, number>();
  private readonly approvalStatus = new Map<string, ApprovalStatus>();

  constructor(private readonly repos: Repositories) {
    this.seed();
  }

  /**
   * Adopt the world as it stands, reporting nothing.
   *
   * Called at startup and after a reset, so rows that already existed are not
   * announced as though they had just been created.
   */
  seed(): void {
    this.agentStatus.clear();
    this.taskStatus.clear();
    this.taskProgress.clear();
    this.approvalStatus.clear();

    for (const agent of this.repos.agents.list()) this.agentStatus.set(agent.id, agent.status);
    for (const task of this.repos.tasks.list()) {
      this.taskStatus.set(task.id, task.status);
      this.taskProgress.set(task.id, task.progress);
    }
    for (const approval of this.repos.approvals.list()) {
      this.approvalStatus.set(approval.id, approval.status);
    }
  }

  /** What this set of changes means, in order. */
  derive(changes: EngineChanges): DomainEvent[] {
    const events: DomainEvent[] = [];

    for (const task of changes.tasks) {
      const previousStatus = this.taskStatus.get(task.id);
      const previousProgress = this.taskProgress.get(task.id);
      this.taskStatus.set(task.id, task.status);
      this.taskProgress.set(task.id, task.progress);

      if (previousStatus === undefined) {
        events.push({
          kind: 'task.created',
          taskId: task.id,
          projectId: task.projectId,
          title: task.title,
        });
      }

      if (previousStatus !== task.status) {
        // `queued` and `working` are both "it has begun" — a live run passes
        // through queued first, and a reader should hear about it once.
        if (
          (task.status === 'queued' || task.status === 'working') &&
          previousStatus !== 'queued' &&
          previousStatus !== 'working'
        ) {
          events.push({
            kind: 'task.started',
            taskId: task.id,
            agentId: task.assignedAgentId,
            runMode: task.runMode,
          });
        }
        if (task.status === 'completed') {
          events.push({
            kind: 'task.completed',
            taskId: task.id,
            agentId: task.assignedAgentId,
            runMode: task.runMode,
          });
        }
        if (task.status === 'failed') {
          events.push({
            kind: 'task.failed',
            taskId: task.id,
            agentId: task.assignedAgentId,
            reason: task.blocker,
          });
        }
      }

      // Progress is noisy by nature: the simulation moves it twice a second.
      // Only whole percentage points are reported, because nothing downstream
      // can act on a fraction, and the row carrying the exact number is already
      // on the wire beside this.
      if (
        task.status === 'working' &&
        previousProgress !== undefined &&
        Math.floor(task.progress) !== Math.floor(previousProgress)
      ) {
        events.push({
          kind: 'task.progress',
          taskId: task.id,
          progress: task.progress,
          runMode: task.runMode,
        });
      }
    }

    for (const agent of changes.agents) {
      const previous = this.agentStatus.get(agent.id);
      this.agentStatus.set(agent.id, agent.status);
      if (previous === agent.status) continue;
      events.push({
        kind: 'agent.status',
        agentId: agent.id,
        from: previous ?? null,
        to: agent.status,
        taskId: agent.currentTaskId,
      });
    }

    for (const approval of changes.approvals) {
      const previous = this.approvalStatus.get(approval.id);
      this.approvalStatus.set(approval.id, approval.status);
      if (previous === approval.status) continue;

      if (approval.status === 'pending') {
        events.push({
          kind: 'approval.requested',
          approvalId: approval.id,
          taskId: approval.taskId,
          agentId: approval.agentId,
          summary: approval.summary,
        });
      } else {
        events.push({
          kind: 'approval.resolved',
          approvalId: approval.id,
          taskId: approval.taskId,
          decision: approval.status,
        });
      }
    }

    return events;
  }
}
