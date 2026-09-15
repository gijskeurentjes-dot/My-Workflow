import type { AgentStatus, TaskStatus } from '@ai-islands/shared';

/**
 * What an agent's status should be, given the work it is holding.
 *
 * An agent's state is a *description* of its task, not an independent fact.
 * Anything that changes which task an agent holds re-derives it from here,
 * rather than leaving the previous one in place to contradict the board — an
 * agent still saying "waiting for approval" after being moved to other work is
 * the interface claiming a decision is pending when none is.
 */
export function agentStatusForTask(taskStatus: TaskStatus): AgentStatus {
  switch (taskStatus) {
    case 'queued':
      return 'queued';
    case 'working':
    case 'delivering':
      return 'working';
    case 'waiting_approval':
      return 'waiting_approval';
    case 'review':
      return 'review';
    case 'paused':
      return 'paused';
    case 'failed':
      return 'failed';
    // Backlog, to do, completed and cancelled all mean the same thing for
    // whoever is holding it: nothing to do right now.
    default:
      return 'idle';
  }
}

/** States that only make sense while an agent is actually holding a task. */
export const STATES_NEEDING_A_TASK: readonly AgentStatus[] = [
  'queued',
  'working',
  'waiting_approval',
  'review',
  'paused',
];
