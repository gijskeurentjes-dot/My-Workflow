import { ARCHETYPES, TASK_TYPES } from './archetypes.js';
import { APPROVAL_PLOT, DELIVERY_PLOT, PLOTS, REST_PLOT } from './geometry.js';
import type { MovementState } from './status.js';
import type { Agent, PlotKey, Task } from './types.js';

/**
 * Derivations both sides need. The server writes them into activity messages;
 * the client shows them in panels. Defining them once means an agent is never
 * described two different ways in two different places.
 */

/**
 * Where an agent should be, given the task it is holding.
 *
 * The task's own building is the answer while it is being worked on — that is
 * what makes the island legible: research happens at the library, code at the
 * workshop, and finished work travels to headquarters and then the depot.
 */
export function desiredPlot(
  agent: Pick<Agent, 'status' | 'currentLocation'>,
  task: Task | null,
): PlotKey {
  if (task) {
    if (task.status === 'delivering') return DELIVERY_PLOT;
    if (task.status === 'waiting_approval') return APPROVAL_PLOT;
    if (task.status === 'working' || task.status === 'failed') return task.buildingKey;
    // Paused work is held exactly where it stopped.
    if (task.status === 'paused') return agent.currentLocation;
  }
  return REST_PLOT;
}

/** The movement state the UI animates, derived from status and motion. */
export function movementState(agent: Pick<Agent, 'status' | 'movement'>): MovementState {
  if (agent.movement) return 'walking';
  switch (agent.status) {
    case 'queued':
      return 'queued';
    case 'working':
      return 'working';
    case 'waiting_approval':
      return 'waiting';
    case 'failed':
      return 'blocked';
    case 'paused':
      return 'paused';
    case 'completed':
    case 'cancelled':
    case 'idle':
    default:
      return 'idle';
  }
}

/** One sentence describing what an agent is doing right now. */
export function describeAgent(agent: Agent, task: Task | null, thoughtIndex = 0): string {
  const profile = ARCHETYPES[agent.archetype];

  if (agent.movement) {
    return `Walking to the ${PLOTS[agent.movement.toKey].label}`;
  }

  switch (agent.status) {
    case 'working': {
      if (task && task.status === 'delivering') {
        return `Carrying “${task.title}” to the ${PLOTS[DELIVERY_PLOT].label}`;
      }
      if (task) {
        const verb = TASK_TYPES[task.type].verb;
        return `${verb.charAt(0).toUpperCase()}${verb.slice(1)} — ${profile.thoughts[thoughtIndex % profile.thoughts.length] ?? ''}`.trim();
      }
      return profile.thoughts[thoughtIndex % profile.thoughts.length] ?? 'Working…';
    }
    case 'queued':
      return task ? `Queued to start “${task.title}”` : 'Queued';
    case 'waiting_approval':
      return `At ${PLOTS[APPROVAL_PLOT].label}, waiting for your decision`;
    case 'paused':
      return task
        ? `Holding at the ${PLOTS[agent.currentLocation].label} — ${Math.round(task.progress)}% preserved`
        : 'Paused';
    case 'failed':
      return task?.blocker ?? 'Blocked — needs a decision from you';
    case 'completed':
      return 'Just delivered — heading back';
    case 'cancelled':
      return 'Work was cancelled';
    case 'idle':
    default:
      return 'Idle — waiting for a task';
  }
}
