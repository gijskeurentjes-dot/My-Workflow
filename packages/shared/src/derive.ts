import { BOT_PROFILES } from './bots.js';
import { PLOTS } from './geometry.js';
import type { MovementState } from './status.js';
import type { Bot, PlotKey, Task } from './types.js';

/**
 * Derivations both sides need. The server writes them into activity messages;
 * the client shows them in panels. Defining them once means a bot is never
 * described two different ways in two different places.
 */

/** Where a bot should be, given the task it is holding. */
export function desiredPlot(bot: Pick<Bot, 'status'>, task: Task | null): PlotKey {
  switch (bot.status) {
    case 'working':
      return 'workbench';
    case 'waiting_approval':
      return 'approval';
    case 'completed':
      return task && task.status === 'delivering' ? 'depot' : 'rest';
    case 'failed':
      return 'workbench';
    case 'paused':
    case 'cancelled':
    case 'idle':
    default:
      return 'rest';
  }
}

/** The movement state the UI animates, derived from status and motion. */
export function movementState(bot: Pick<Bot, 'status' | 'movement'>): MovementState {
  if (bot.movement) return 'walking';
  switch (bot.status) {
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

/** One sentence describing what a bot is doing right now. */
export function describeBot(bot: Bot, task: Task | null, thoughtIndex = 0): string {
  const profile = BOT_PROFILES[bot.key];
  if (bot.movement) {
    return `Walking to the ${PLOTS[bot.movement.toKey].label}`;
  }
  switch (bot.status) {
    case 'working': {
      const thoughts = profile.thoughts;
      return thoughts[thoughtIndex % thoughts.length] ?? 'Working…';
    }
    case 'waiting_approval':
      return `At the ${PLOTS.approval.label}, waiting for your decision`;
    case 'paused':
      return task
        ? `Holding at the ${PLOTS[bot.locationKey].label} — ${Math.round(task.progress)}% preserved`
        : 'Paused';
    case 'failed':
      return task?.blocker ?? 'Blocked — needs a decision from you';
    case 'completed':
      return 'Just delivered — heading back to rest';
    case 'cancelled':
      return 'Work was cancelled';
    case 'idle':
    default:
      return 'Idle — waiting for a task';
  }
}
