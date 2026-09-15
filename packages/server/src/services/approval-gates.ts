import type { Id } from '@ai-islands/shared';

/**
 * Runs that are stopped, waiting for a person.
 *
 * A gate is the moment an agent asks before acting: the run is genuinely
 * suspended — no tokens, no tool calls, nothing happening — until someone
 * approves, rejects, or calls the work off. Approving resumes exactly where it
 * stopped.
 *
 * This registry is deliberately the only place that knowledge lives. The
 * request row says a person *should* decide; a gate is the fact that a running
 * process is waiting on it, and that fact cannot survive a restart — so on
 * startup there are no open gates, and a pending request whose run has gone is
 * answered by the task's own state rather than by an orphaned promise.
 */
export type ApprovalOutcome = 'approved' | 'rejected' | 'cancelled';

interface OpenGate {
  taskId: Id;
  agentId: Id;
  settle: (outcome: ApprovalOutcome) => void;
  openedAt: number;
}

export class ApprovalGateRegistry {
  private readonly open = new Map<Id, OpenGate>();

  /**
   * Stop here until someone decides.
   *
   * Returns the outcome. It never rejects: a refusal is an answer, not an
   * error, and callers should be able to `await` this without a try/catch
   * around ordinary human behaviour.
   */
  wait(approvalId: Id, taskId: Id, agentId: Id): Promise<ApprovalOutcome> {
    return new Promise<ApprovalOutcome>((resolve) => {
      this.open.set(approvalId, {
        taskId,
        agentId,
        openedAt: Date.now(),
        settle: (outcome) => {
          this.open.delete(approvalId);
          resolve(outcome);
        },
      });
    });
  }

  /** Answer a gate. Returns false when nothing was waiting on it. */
  settle(approvalId: Id, outcome: ApprovalOutcome): boolean {
    const gate = this.open.get(approvalId);
    if (!gate) return false;
    gate.settle(outcome);
    return true;
  }

  isOpen(approvalId: Id): boolean {
    return this.open.has(approvalId);
  }

  /** The gate a task is stopped at, if it is stopped at one. */
  openForTask(taskId: Id): Id | null {
    for (const [id, gate] of this.open) {
      if (gate.taskId === taskId) return id;
    }
    return null;
  }

  /** How long this run has been waiting on a person. */
  waitingSince(approvalId: Id): number | null {
    return this.open.get(approvalId)?.openedAt ?? null;
  }

  /** Release every waiting run. Called when a task ends or on shutdown. */
  cancelForTask(taskId: Id): number {
    let released = 0;
    for (const [id, gate] of [...this.open]) {
      if (gate.taskId !== taskId) continue;
      gate.settle('cancelled');
      released += 1;
    }
    return released;
  }

  cancelAll(): void {
    for (const [, gate] of [...this.open]) gate.settle('cancelled');
    this.open.clear();
  }

  get size(): number {
    return this.open.size;
  }
}
