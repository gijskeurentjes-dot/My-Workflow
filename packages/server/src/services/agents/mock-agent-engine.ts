import {
  BOT_PROFILES,
  PLOTS,
  TASK_TYPES,
  travelDurationMs,
  type ActivityEvent,
  type ActivityKind,
  type Bot,
  type EngineInfo,
  type PlotKey,
  type Task,
} from '@ai-islands/shared';
import { newId } from '../../ids.js';
import type { Repositories } from '../../repositories/types.js';
import { ChangeSet, hasChanges, type AgentEngine, type EngineChanges } from './agent-engine.js';

export interface MockAgentEngineOptions {
  tickMs?: number;
  /**
   * Whether idle bots pick work off the board on their own.
   *
   * On by default so the demo world keeps moving without anyone clicking. Turn
   * it off to drive every task by hand.
   */
  autoAssign?: boolean;
  /** How long a bot celebrates a delivery before returning to idle. */
  celebrationMs?: number;
  /** Called after any tick that changed something. */
  onChange?: (changes: EngineChanges) => void;
}

/**
 * A deterministic simulation of five agents at work.
 *
 * Nothing here calls a model. Progress, walking, approvals and deliveries are
 * produced by the state machine below — but the states, the transitions and the
 * events it emits are the real ones, so replacing this class with a
 * Claude-backed engine does not change a single screen.
 */
export class MockAgentEngine implements AgentEngine {
  readonly kind = 'mock';

  private readonly repos: Repositories;
  private readonly tickMs: number;
  private readonly autoAssign: boolean;
  private readonly celebrationMs: number;
  private readonly onChange: ((changes: EngineChanges) => void) | undefined;

  private timer: NodeJS.Timeout | null = null;
  private lastTickAt: number | null = null;

  constructor(repos: Repositories, options: MockAgentEngineOptions = {}) {
    this.repos = repos;
    this.tickMs = options.tickMs ?? 500;
    this.autoAssign = options.autoAssign ?? true;
    this.celebrationMs = options.celebrationMs ?? 3000;
    this.onChange = options.onChange;
  }

  start(): void {
    if (this.timer) return;
    this.lastTickAt = Date.now();
    this.timer = setInterval(() => {
      const changes = this.tick();
      if (hasChanges(changes)) this.onChange?.(changes);
    }, this.tickMs);
    // The world ticking is not a reason to hold the process open.
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.lastTickAt = null;
  }

  info(): EngineInfo {
    return { kind: this.kind, running: this.timer !== null, tickMs: this.tickMs };
  }

  /**
   * Advance the world by however long has passed since the previous tick.
   *
   * Elapsed time is clamped, so a process that was suspended for a minute does
   * not finish every task at once when it wakes up.
   */
  tick(now: number = Date.now()): EngineChanges {
    const elapsedMs = this.lastTickAt === null ? this.tickMs : Math.min(5000, now - this.lastTickAt);
    this.lastTickAt = now;

    const changes = new ChangeSet();
    this.repos.transaction(() => {
      for (const task of this.repos.tasks.listAdvanceable()) {
        this.advanceTask(task, elapsedMs, now, changes);
      }
      this.settleIdleBots(now, changes);
      if (this.autoAssign) this.assignFromBacklog(now, changes);
    });

    return changes.build();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // One task, one tick
  // ───────────────────────────────────────────────────────────────────────────

  private advanceTask(task: Task, elapsedMs: number, now: number, changes: ChangeSet): void {
    if (!task.botId) return;
    const bot = this.repos.bots.findById(task.botId);
    if (!bot) return;

    // A bot in transit does nothing else until it arrives.
    if (bot.movement) {
      if (now < bot.movement.arrivesAt) return;
      this.arrive(bot, task, now, changes);
      return;
    }

    const destination = this.destinationFor(bot, task);
    if (destination !== bot.locationKey) {
      this.depart(bot, destination, task, now, changes);
      return;
    }

    // Standing in the right place — do the work of this state.
    switch (task.status) {
      case 'working':
        this.doWork(bot, task, elapsedMs, now, changes);
        break;
      case 'delivering':
        // Arrived at the depot; `arrive` completes it. Nothing to do here.
        break;
      case 'waiting_approval':
      case 'paused':
      case 'failed':
      case 'cancelled':
        break;
      default:
        break;
    }
  }

  /** Where this bot should be standing, given the task it holds. */
  private destinationFor(bot: Bot, task: Task): PlotKey {
    if (task.status === 'delivering') return 'depot';
    if (task.status === 'waiting_approval') return 'approval';
    if (task.status === 'working' || task.status === 'failed') return 'workbench';
    // Paused work is held exactly where it stopped.
    if (task.status === 'paused') return bot.locationKey;
    return 'rest';
  }

  private depart(bot: Bot, to: PlotKey, task: Task | null, now: number, changes: ChangeSet): void {
    const durationMs = travelDurationMs(bot.locationKey, to);
    if (durationMs === 0) {
      changes.bot(this.repos.bots.update(bot.id, { locationKey: to, movement: null, updatedAt: now }));
      return;
    }

    const updated = this.repos.bots.update(bot.id, {
      movement: {
        fromKey: bot.locationKey,
        toKey: to,
        departedAt: now,
        arrivesAt: now + durationMs,
      },
      updatedAt: now,
    });
    changes.bot(updated);
    this.log(changes, 'departed', `${bot.name} set off for the ${PLOTS[to].label}`, {
      task,
      bot,
      at: now,
    });
  }

  private arrive(bot: Bot, task: Task, now: number, changes: ChangeSet): void {
    const arrivedAt = bot.movement?.toKey ?? bot.locationKey;
    const landed = this.repos.bots.update(bot.id, {
      locationKey: arrivedAt,
      movement: null,
      updatedAt: now,
    });
    changes.bot(landed);

    // Reaching the depot with work in hand is what completes a task.
    if (arrivedAt === 'depot' && task.status === 'delivering') {
      this.completeDelivery(bot, task, now, changes);
      return;
    }

    if (arrivedAt === 'workbench' && task.status === 'working') {
      const verb = TASK_TYPES[task.type].verb;
      this.log(changes, 'arrived', `${bot.name} reached the ${PLOTS.workbench.label} and is ${verb} “${task.title}”`, { task, bot, at: now });
      return;
    }

    if (arrivedAt === 'approval' && task.status === 'waiting_approval') {
      this.log(changes, 'arrived', `${bot.name} is at the ${PLOTS.approval.label} with “${task.title}”`, { task, bot, at: now });
    }
  }

  private doWork(bot: Bot, task: Task, elapsedMs: number, now: number, changes: ChangeSet): void {
    const perMs = 100 / (task.durationSeconds * 1000);
    const progress = Math.min(100, task.progress + perMs * elapsedMs);

    if (progress < 100) {
      changes.task(this.repos.tasks.update(task.id, { progress }));
      changes.bot(this.repos.bots.update(bot.id, { progress, updatedAt: now }));
      return;
    }

    // Finished. Either it needs your sign-off, or it goes straight to the depot.
    if (task.needsApproval) {
      const updatedTask = this.repos.tasks.update(task.id, {
        progress: 100,
        status: 'waiting_approval',
      });
      changes.task(updatedTask);
      changes.bot(
        this.repos.bots.update(bot.id, {
          status: 'waiting_approval',
          progress: 100,
          updatedAt: now,
        }),
      );

      const approval = this.repos.approvals.create({
        id: newId('apr'),
        taskId: task.id,
        botId: bot.id,
        summary: `${bot.name} finished “${task.title}” and needs your sign-off before it is delivered.`,
        status: 'pending',
        requestedAt: now,
        decidedAt: null,
        note: null,
      });
      changes.approval(approval);
      this.log(changes, 'approval_requested', `${bot.name} finished “${task.title}” and is waiting for your approval`, { task, bot, at: now });
      return;
    }

    const updatedTask = this.repos.tasks.update(task.id, { progress: 100, status: 'delivering' });
    changes.task(updatedTask);
    changes.bot(this.repos.bots.update(bot.id, { progress: 100, updatedAt: now }));
    this.log(changes, 'progress', `${bot.name} finished “${task.title}” and is carrying it to the ${PLOTS.depot.label}`, { task, bot, at: now });
  }

  private completeDelivery(bot: Bot, task: Task, now: number, changes: ChangeSet): void {
    const done = this.repos.tasks.update(task.id, {
      status: 'completed',
      progress: 100,
      completedAt: now,
    });
    changes.task(done);

    this.repos.islands.addCrate(task.islandId);
    changes.islands();

    changes.bot(
      this.repos.bots.update(bot.id, {
        status: 'completed',
        taskId: null,
        progress: 0,
        updatedAt: now,
      }),
    );
    this.log(changes, 'delivered', `${bot.name} delivered “${task.title}” to the ${PLOTS.depot.label}`, { task, bot, at: now });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Bots with nothing to do
  // ───────────────────────────────────────────────────────────────────────────

  /** Walk bots without work back to the rest point, and end celebrations. */
  private settleIdleBots(now: number, changes: ChangeSet): void {
    for (const bot of this.repos.bots.list()) {
      if (bot.taskId !== null) continue;

      if (bot.movement) {
        if (now < bot.movement.arrivesAt) continue;
        changes.bot(
          this.repos.bots.update(bot.id, {
            locationKey: bot.movement.toKey,
            movement: null,
            updatedAt: now,
          }),
        );
        continue;
      }

      // A delivery is worth a moment of celebration before going back to idle.
      if (bot.status === 'completed') {
        if (now - bot.updatedAt < this.celebrationMs) continue;
        changes.bot(this.repos.bots.update(bot.id, { status: 'idle', updatedAt: now }));
        continue;
      }

      if (bot.status === 'idle' && bot.locationKey !== 'rest') {
        this.depart(bot, 'rest', null, now, changes);
      }
    }
  }

  /**
   * Hand waiting work to whichever agent owns that kind of task.
   *
   * This is the mock stand-in for Atlas delegating. A real engine would ask the
   * project manager agent to make the call instead.
   */
  private assignFromBacklog(now: number, changes: ChangeSet): void {
    const backlog = this.repos.tasks.list({ status: 'backlog' });
    if (backlog.length === 0) return;

    // Only bots that are genuinely free and standing still can pick work up.
    const available = new Map(
      this.repos.bots
        .list()
        .filter((b) => b.taskId === null && b.status === 'idle' && !b.movement)
        .map((b) => [b.key, b]),
    );
    if (available.size === 0) return;

    for (const task of backlog) {
      const profile = Object.values(BOT_PROFILES).find((p) => p.handles.includes(task.type));
      if (!profile) continue;
      const bot = available.get(profile.key);
      if (!bot) continue;

      available.delete(profile.key);

      changes.task(
        this.repos.tasks.update(task.id, {
          status: 'working',
          botId: bot.id,
          startedAt: now,
          blocker: null,
        }),
      );
      changes.bot(
        this.repos.bots.update(bot.id, {
          status: 'working',
          taskId: task.id,
          progress: task.progress,
          updatedAt: now,
        }),
      );
      this.log(changes, 'assigned', `${bot.name} picked up “${task.title}” from the board`, {
        task,
        bot,
        at: now,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────

  private log(
    changes: ChangeSet,
    kind: ActivityKind,
    message: string,
    ctx: { task: Task | null; bot: Bot | null; at: number },
  ): void {
    const event: ActivityEvent = {
      id: newId('evt'),
      kind,
      message,
      projectId: ctx.task?.projectId ?? null,
      taskId: ctx.task?.id ?? null,
      botId: ctx.bot?.id ?? null,
      islandId: ctx.task?.islandId ?? ctx.bot?.islandId ?? null,
      at: ctx.at,
    };
    this.repos.activity.create(event);
    changes.activity(event);
  }
}
