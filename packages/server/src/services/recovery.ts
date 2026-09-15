import type { Repositories } from '../repositories/types.js';
import { ChangeSet, type EngineChanges } from './agents/agent-engine.js';
import { newId } from '../ids.js';

/**
 * Tidy up runs that did not survive the process.
 *
 * A blocking approval is a promise held in memory: a run is genuinely stopped
 * on it. Memory does not survive a restart, so on boot any request still marked
 * pending-and-blocking belongs to a run that no longer exists. Left alone it
 * would sit in the queue forever, offering buttons that cannot do anything —
 * the worst kind of interface, one that lies about what it can do.
 *
 * So each one is withdrawn, and its task is marked failed with a blocker that
 * says what happened and what to do about it. Nothing is lost: the task, its
 * history and its results are all still there, and Retry runs it again.
 */
export function recoverInterruptedRuns(repos: Repositories): EngineChanges {
  const stranded = repos.approvals.list({ status: 'pending' }).filter((a) => a.blocking);
  const changes = new ChangeSet();
  if (stranded.length === 0) return changes.build();

  const now = Date.now();
  const reason = 'The server restarted while this run was waiting for your decision.';

  repos.transaction(() => {
    for (const request of stranded) {
      changes.approval(repos.approvals.decide(request.id, 'cancelled', reason));

      const task = repos.tasks.findById(request.taskId);
      if (task && task.status === 'waiting_approval') {
        changes.task(
          repos.tasks.update(task.id, {
            status: 'failed',
            blocker: `${reason} Nothing was done without your approval. Retry to run it again.`,
          }),
        );
      }

      const agent = repos.agents.findById(request.agentId);
      if (agent && agent.status === 'waiting_approval') {
        changes.agent(repos.agents.update(agent.id, { status: 'failed', updatedAt: now }));
      }

      const event = {
        id: newId('evt'),
        projectId: task?.projectId ?? agent?.projectId ?? null,
        agentId: request.agentId,
        taskId: request.taskId,
        eventType: 'system' as const,
        message: `“${request.action}” was never done: ${reason}`,
        timestamp: now,
      };
      repos.activity.create(event);
      changes.activity(event);
    }
    changes.approvalsDirty();
  });

  return changes.build();
}
