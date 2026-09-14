import {
  APPROVAL_PLOT,
  DELIVERY_PLOT,
  PLOTS,
  REST_PLOT,
  TASK_TYPES,
  archetypeForTaskType,
  travelDurationMs,
  type ActivityEvent,
  type ActivityEventType,
  type Agent,
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
   * Whether idle agents pick work off their project's board on their own.
   *
   * On by default so the demo world keeps moving without anyone clicking. Turn
   * it off to drive every task by hand.
   */
  autoAssign?: boolean;
  /** How long an agent celebrates a delivery before returning to idle. */
  celebrationMs?: number;
  /** Called after any tick that changed something. */
  onChange?: (changes: EngineChanges) => void;
}

/**
 * A deterministic simulation of agents at work.
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
      this.settleIdleAgents(now, changes);
      if (this.autoAssign) this.assignFromBacklog(now, changes);
    });

    return changes.build();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // One task, one tick
  // ───────────────────────────────────────────────────────────────────────────

  private advanceTask(task: Task, elapsedMs: number, now: number, changes: ChangeSet): void {
    if (!task.assignedAgentId) return;
    const agent = this.repos.agents.findById(task.assignedAgentId);
    if (!agent) return;

    // An agent in transit does nothing else until it arrives.
    if (agent.movement) {
      if (now < agent.movement.arrivesAt) return;
      this.arrive(agent, task, now, changes);
      return;
    }

    const destination = this.destinationFor(agent, task);
    if (destination !== agent.currentLocation) {
      this.depart(agent, destination, task, now, changes);
      return;
    }

    // Standing in the right place — do the work of this state.
    if (task.status === 'working') this.doWork(agent, task, elapsedMs, now, changes);
  }

  /** Where this agent should be standing, given the task it holds. */
  private destinationFor(agent: Agent, task: Task): PlotKey {
    if (task.status === 'delivering') return DELIVERY_PLOT;
    if (task.status === 'waiting_approval') return APPROVAL_PLOT;
    // The task's own building is what makes the island legible: research at the
    // library, code at the workshop, slides at the studio.
    if (task.status === 'working' || task.status === 'failed') return task.buildingKey;
    // Paused work is held exactly where it stopped.
    if (task.status === 'paused') return agent.currentLocation;
    return REST_PLOT;
  }

  private depart(
    agent: Agent,
    to: PlotKey,
    task: Task | null,
    now: number,
    changes: ChangeSet,
  ): void {
    const durationMs = travelDurationMs(agent.currentLocation, to);
    if (durationMs === 0) {
      changes.agent(
        this.repos.agents.update(agent.id, {
          currentLocation: to,
          movement: null,
          updatedAt: now,
        }),
      );
      return;
    }

    changes.agent(
      this.repos.agents.update(agent.id, {
        movement: {
          fromKey: agent.currentLocation,
          toKey: to,
          departedAt: now,
          arrivesAt: now + durationMs,
        },
        updatedAt: now,
      }),
    );
    this.log(changes, 'departed', `${agent.name} set off for the ${PLOTS[to].label}`, {
      task,
      agent,
      at: now,
    });
  }

  private arrive(agent: Agent, task: Task, now: number, changes: ChangeSet): void {
    const arrivedAt = agent.movement?.toKey ?? agent.currentLocation;
    changes.agent(
      this.repos.agents.update(agent.id, {
        currentLocation: arrivedAt,
        movement: null,
        updatedAt: now,
      }),
    );

    // Reaching the depot with work in hand is what completes a task.
    if (arrivedAt === DELIVERY_PLOT && task.status === 'delivering') {
      this.completeDelivery(agent, task, now, changes);
      return;
    }

    if (arrivedAt === task.buildingKey && task.status === 'working') {
      const verb = TASK_TYPES[task.type].verb;
      this.log(
        changes,
        'arrived',
        `${agent.name} reached the ${PLOTS[task.buildingKey].label} and is ${verb} “${task.title}”`,
        { task, agent, at: now },
      );
      return;
    }

    if (arrivedAt === APPROVAL_PLOT && task.status === 'waiting_approval') {
      this.log(
        changes,
        'arrived',
        `${agent.name} is at ${PLOTS[APPROVAL_PLOT].label} with “${task.title}”`,
        { task, agent, at: now },
      );
    }
  }

  private doWork(
    agent: Agent,
    task: Task,
    elapsedMs: number,
    now: number,
    changes: ChangeSet,
  ): void {
    const perMs = 100 / (task.durationSeconds * 1000);
    const progress = Math.min(100, task.progress + perMs * elapsedMs);

    if (progress < 100) {
      changes.task(this.repos.tasks.update(task.id, { progress }));
      changes.agent(this.repos.agents.update(agent.id, { progress, updatedAt: now }));
      return;
    }

    // Finished. Either it needs your sign-off, or it goes straight to the depot.
    if (task.needsApproval) {
      changes.task(this.repos.tasks.update(task.id, { progress: 100, status: 'waiting_approval' }));
      changes.agent(
        this.repos.agents.update(agent.id, {
          status: 'waiting_approval',
          progress: 100,
          updatedAt: now,
        }),
      );

      changes.approval(
        this.repos.approvals.create({
          id: newId('apr'),
          taskId: task.id,
          agentId: agent.id,
          summary: `${agent.name} finished “${task.title}” and needs your sign-off before it is delivered.`,
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
        { task, agent, at: now },
      );
      return;
    }

    changes.task(this.repos.tasks.update(task.id, { progress: 100, status: 'delivering' }));
    changes.agent(this.repos.agents.update(agent.id, { progress: 100, updatedAt: now }));
    this.log(
      changes,
      'progress',
      `${agent.name} finished “${task.title}” and is carrying it to the ${PLOTS[DELIVERY_PLOT].label}`,
      { task, agent, at: now },
    );
  }

  private completeDelivery(agent: Agent, task: Task, now: number, changes: ChangeSet): void {
    changes.task(
      this.repos.tasks.update(task.id, { status: 'completed', progress: 100, completedAt: now }),
    );

    this.repos.projects.addCrate(task.projectId);
    changes.projects();

    changes.agent(
      this.repos.agents.update(agent.id, {
        status: 'completed',
        currentTaskId: null,
        progress: 0,
        updatedAt: now,
      }),
    );
    this.log(
      changes,
      'delivered',
      `${agent.name} delivered “${task.title}” to the ${PLOTS[DELIVERY_PLOT].label}`,
      { task, agent, at: now },
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Agents with nothing to do
  // ───────────────────────────────────────────────────────────────────────────

  /** Walk agents without work back to rest, and end celebrations. */
  private settleIdleAgents(now: number, changes: ChangeSet): void {
    for (const agent of this.repos.agents.list()) {
      if (agent.currentTaskId !== null) continue;

      if (agent.movement) {
        if (now < agent.movement.arrivesAt) continue;
        changes.agent(
          this.repos.agents.update(agent.id, {
            currentLocation: agent.movement.toKey,
            movement: null,
            updatedAt: now,
          }),
        );
        continue;
      }

      // A delivery is worth a moment of celebration before going back to idle.
      if (agent.status === 'completed') {
        if (now - agent.updatedAt < this.celebrationMs) continue;
        changes.agent(this.repos.agents.update(agent.id, { status: 'idle', updatedAt: now }));
        continue;
      }

      if (agent.status === 'idle' && agent.currentLocation !== REST_PLOT) {
        this.depart(agent, REST_PLOT, null, now, changes);
      }
    }
  }

  /**
   * Hand waiting work to whichever agent on that project owns the kind of task.
   *
   * This is the mock stand-in for a project manager delegating. A real engine
   * would ask the PM agent to make the call instead.
   */
  private assignFromBacklog(now: number, changes: ChangeSet): void {
    const backlog = this.repos.tasks.list({ status: 'backlog' });
    if (backlog.length === 0) return;

    // Only agents that are genuinely free and standing still can pick work up.
    const available = this.repos.agents
      .list()
      .filter((a) => a.currentTaskId === null && a.status === 'idle' && !a.movement);
    if (available.length === 0) return;

    const taken = new Set<string>();

    // `backlog` is already urgent-first, so the most important job is offered
    // before anything else is considered.
    for (const task of backlog) {
      const wanted = archetypeForTaskType(task.type);
      // An agent only works its own project's board — a team does not quietly
      // pick up another project's work.
      const agent = available.find(
        (a) => !taken.has(a.id) && a.projectId === task.projectId && a.archetype === wanted,
      );
      if (!agent) continue;

      taken.add(agent.id);

      changes.task(
        this.repos.tasks.update(task.id, {
          status: 'working',
          assignedAgentId: agent.id,
          startedAt: now,
          blocker: null,
        }),
      );
      changes.agent(
        this.repos.agents.update(agent.id, {
          status: 'working',
          currentTaskId: task.id,
          progress: task.progress,
          updatedAt: now,
        }),
      );
      this.log(changes, 'assigned', `${agent.name} picked up “${task.title}” from the board`, {
        task,
        agent,
        at: now,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────

  private log(
    changes: ChangeSet,
    eventType: ActivityEventType,
    message: string,
    ctx: { task: Task | null; agent: Agent | null; at: number },
  ): void {
    const event: ActivityEvent = {
      id: newId('evt'),
      projectId: ctx.task?.projectId ?? ctx.agent?.projectId ?? null,
      agentId: ctx.agent?.id ?? null,
      taskId: ctx.task?.id ?? null,
      eventType,
      message,
      timestamp: ctx.at,
    };
    this.repos.activity.create(event);
    changes.activity(event);
  }
}
