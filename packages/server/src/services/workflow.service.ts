import {
  BOT_PROFILES,
  PLOTS,
  TASK_TYPES,
  defaultBotForTaskType,
  isTerminalTaskStatus,
  type ActivityEvent,
  type ActivityKind,
  type Bot,
  type Id,
  type Project,
  type Task,
  type TaskPriority,
  type TaskType,
} from '@ai-islands/shared';
import { invalid, notFound, refuse } from '../errors.js';
import { newId } from '../ids.js';
import type { Repositories } from '../repositories/types.js';
import { ChangeSet, type EngineChanges } from './agents/agent-engine.js';

/**
 * Everything a person can ask the world to do.
 *
 * The agent engine advances work on its own; this service is the other half —
 * the commands you issue. Both write through the same repositories and report
 * what changed the same way, so a task started by hand and a task picked up
 * automatically are indistinguishable downstream.
 *
 * Every rule about which transition is legal lives here. Routes only translate
 * HTTP into a call, and the UI only disables buttons as a courtesy — the
 * refusal is enforced on this side.
 */
export class WorkflowService {
  constructor(private readonly repos: Repositories) {}

  // ── Projects ──────────────────────────────────────────────────────────────

  createProject(input: { name: string; goal?: string; color?: string }): {
    project: Project;
    changes: EngineChanges;
  } {
    const name = input.name?.trim();
    if (!name) throw invalid('A project needs a name.');

    return this.repos.transaction(() => {
      const now = Date.now();
      const project = this.repos.projects.create({
        id: newId('prj'),
        name,
        goal: input.goal?.trim() ?? '',
        status: 'active',
        color: input.color ?? '#4a8ff0',
        createdAt: now,
        updatedAt: now,
      });

      const changes = new ChangeSet();
      changes.projects();
      this.log(changes, 'created', `Project “${project.name}” was created`, {
        projectId: project.id,
        at: now,
      });
      return { project, changes: changes.build() };
    });
  }

  updateProject(
    id: Id,
    patch: { name?: string; goal?: string; status?: Project['status']; color?: string },
  ): { project: Project; changes: EngineChanges } {
    const existing = this.repos.projects.findById(id);
    if (!existing) throw notFound('Project');
    if (patch.name !== undefined && !patch.name.trim()) {
      throw invalid('A project needs a name.');
    }

    return this.repos.transaction(() => {
      const project = this.repos.projects.update(id, {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.goal !== undefined ? { goal: patch.goal.trim() } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
      });
      if (!project) throw notFound('Project');

      const changes = new ChangeSet();
      changes.projects();
      if (patch.status && patch.status !== existing.status) {
        this.log(changes, 'system', `Project “${project.name}” is now ${patch.status}`, {
          projectId: project.id,
          at: Date.now(),
        });
      }
      return { project, changes: changes.build() };
    });
  }

  /**
   * Delete a project and everything in it.
   *
   * Any agent holding one of its tasks is released first — the foreign key
   * would null the task's bot_id, but the bot would still think it is working.
   */
  deleteProject(id: Id): EngineChanges {
    const project = this.repos.projects.findById(id);
    if (!project) throw notFound('Project');

    return this.repos.transaction(() => {
      const changes = new ChangeSet();
      changes.projects();
      for (const task of this.repos.tasks.list({ projectId: id })) {
        if (this.repos.approvals.findPendingByTask(task.id)) changes.approvalsDirty();
        if (task.botId) this.releaseBot(task.botId, changes);
      }
      this.repos.projects.delete(id);
      this.log(changes, 'system', `Project “${project.name}” and its tasks were deleted`, {
        at: Date.now(),
      });
      return changes.build();
    });
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────

  createTask(input: {
    projectId: Id;
    title: string;
    notes?: string;
    type: TaskType;
    priority?: TaskPriority;
    needsApproval?: boolean;
    /** Assign and start immediately, rather than leaving it on the board. */
    botId?: Id | null;
    autoStart?: boolean;
  }): { task: Task; changes: EngineChanges } {
    const project = this.repos.projects.findById(input.projectId);
    if (!project) throw notFound('Project');

    const title = input.title?.trim();
    if (!title) throw invalid('A task needs a title.');
    if (!TASK_TYPES[input.type]) throw invalid(`Unknown kind of work: ${input.type}`);

    // The kind of work decides where it happens. That mapping is not optional —
    // it is what makes the world legible.
    const islandKey = TASK_TYPES[input.type].island;
    const island = this.repos.islands.findByKey(islandKey);
    if (!island) throw refuse(`No island exists for ${islandKey} work.`);

    return this.repos.transaction(() => {
      const now = Date.now();
      const task = this.repos.tasks.create({
        id: newId('tsk'),
        projectId: project.id,
        title,
        notes: input.notes?.trim() ?? '',
        type: input.type,
        status: 'backlog',
        priority: input.priority ?? 'normal',
        islandId: island.id,
        botId: null,
        progress: 0,
        // A spread of durations so a board of new tasks does not finish in lockstep.
        durationSeconds: 100 + Math.round(Math.random() * 70),
        needsApproval: input.needsApproval !== false,
        blocker: null,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        completedAt: null,
      });

      const changes = new ChangeSet();
      changes.task(task);
      this.log(changes, 'created', `“${task.title}” was added to the board`, { task, at: now });

      if (input.botId) {
        this.assignInternal(task.id, input.botId, changes);
        if (input.autoStart) this.startInternal(task.id, changes);
      }

      const fresh = this.repos.tasks.findById(task.id) ?? task;
      return { task: fresh, changes: changes.build() };
    });
  }

  updateTask(
    id: Id,
    patch: { title?: string; notes?: string; needsApproval?: boolean; priority?: TaskPriority },
  ): { task: Task; changes: EngineChanges } {
    const task = this.requireTask(id);
    if (patch.title !== undefined && !patch.title.trim()) {
      throw invalid('A task needs a title.');
    }

    return this.repos.transaction(() => {
      const changes = new ChangeSet();

      if (patch.needsApproval !== undefined && patch.needsApproval !== task.needsApproval) {
        // Changing this once the work is already sitting at the Approval Post
        // would strand a request that is waiting on a human decision.
        if (task.status === 'waiting_approval' || task.status === 'delivering') {
          throw refuse(
            'This work is already finished and waiting on you. Approve or send it back instead.',
          );
        }
        if (isTerminalTaskStatus(task.status)) {
          throw refuse('This task is finished; its approval setting can no longer change.');
        }
        this.log(
          changes,
          'system',
          patch.needsApproval
            ? `“${task.title}” now needs your approval before delivery`
            : `“${task.title}” will now be delivered without approval`,
          { task, at: Date.now() },
        );
      }

      if (patch.priority !== undefined && patch.priority !== task.priority) {
        this.log(
          changes,
          'system',
          `“${task.title}” was moved to ${patch.priority} priority`,
          { task, at: Date.now() },
        );
      }

      const updated = this.repos.tasks.update(id, {
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes.trim() } : {}),
        ...(patch.needsApproval !== undefined ? { needsApproval: patch.needsApproval } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      });
      if (!updated) throw notFound('Task');

      changes.task(updated);
      return { task: updated, changes: changes.build() };
    });
  }

  deleteTask(id: Id): EngineChanges {
    const task = this.requireTask(id);
    return this.repos.transaction(() => {
      const changes = new ChangeSet();
      // The row is cascade-deleted with the task, so there is nothing to push —
      // but the queue changed, and open screens have to hear about it.
      if (this.repos.approvals.findPendingByTask(id)) changes.approvalsDirty();
      if (task.botId) this.releaseBot(task.botId, changes);
      this.repos.tasks.delete(id);
      this.log(changes, 'system', `“${task.title}” was deleted`, {
        projectId: task.projectId,
        at: Date.now(),
      });
      return changes.build();
    });
  }

  // ── Agents ────────────────────────────────────────────────────────────────

  /**
   * Edit an agent's brief.
   *
   * `instructions` is what a real engine sends as this agent's system prompt
   * and `tools` is what it may reach for, so this is the screen where you shape
   * an agent's behaviour. Storing it rather than hardcoding it is what lets the
   * brief change without a deploy.
   */
  updateBot(
    id: Id,
    patch: { name?: string; role?: string; instructions?: string; tools?: string[] },
  ): { bot: Bot; changes: EngineChanges } {
    const existing = this.repos.bots.findById(id);
    if (!existing) throw notFound('Agent');
    if (patch.name !== undefined && !patch.name.trim()) throw invalid('An agent needs a name.');

    return this.repos.transaction(() => {
      const bot = this.repos.bots.update(id, {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.role !== undefined ? { role: patch.role.trim() } : {}),
        ...(patch.instructions !== undefined ? { instructions: patch.instructions.trim() } : {}),
        ...(patch.tools !== undefined
          ? { tools: patch.tools.map((t) => t.trim()).filter(Boolean) }
          : {}),
      });
      if (!bot) throw notFound('Agent');

      const changes = new ChangeSet();
      changes.bot(bot);

      // Say what changed rather than "was updated" — the brief is the thing
      // that decides how this agent behaves once a real engine is behind it.
      const edited = [
        patch.name !== undefined && patch.name.trim() !== existing.name ? 'name' : null,
        patch.role !== undefined && patch.role.trim() !== existing.role ? 'role' : null,
        patch.instructions !== undefined && patch.instructions.trim() !== existing.instructions
          ? 'instructions'
          : null,
        patch.tools !== undefined ? 'tools' : null,
      ].filter((x): x is string => x !== null);

      if (edited.length > 0) {
        this.log(changes, 'system', `${bot.name}’s ${edited.join(' and ')} ${edited.length > 1 ? 'were' : 'was'} updated`, {
          bot,
          at: Date.now(),
        });
      }

      return { bot, changes: changes.build() };
    });
  }

  // ── Running work ──────────────────────────────────────────────────────────

  assignTask(taskId: Id, botId: Id): EngineChanges {
    return this.repos.transaction(() => {
      const changes = new ChangeSet();
      this.assignInternal(taskId, botId, changes);
      return changes.build();
    });
  }

  /** Take the task off whoever holds it and put it back on the board. */
  unassignTask(taskId: Id): EngineChanges {
    const task = this.requireTask(taskId);
    if (!task.botId) throw refuse('Nobody is holding this task.');

    return this.repos.transaction(() => {
      const changes = new ChangeSet();
      const bot = this.repos.bots.findById(task.botId!);
      this.withdrawApproval(taskId, 'The task was taken off its agent', changes);
      this.releaseBot(task.botId!, changes);
      changes.task(
        this.repos.tasks.update(taskId, { botId: null, status: 'backlog', blocker: null }),
      );
      this.log(changes, 'assigned', `“${task.title}” went back on the board`, {
        task,
        bot,
        at: Date.now(),
      });
      return changes.build();
    });
  }

  startTask(taskId: Id): EngineChanges {
    return this.repos.transaction(() => {
      const changes = new ChangeSet();
      this.startInternal(taskId, changes);
      return changes.build();
    });
  }

  /** Freeze progress exactly where it is. The agent holds its position. */
  pauseTask(taskId: Id): EngineChanges {
    const task = this.requireTask(taskId);
    if (task.status !== 'working') {
      throw refuse(`Only work in progress can be paused — this task is ${task.status}.`);
    }

    return this.repos.transaction(() => {
      const changes = new ChangeSet();
      const bot = task.botId ? this.repos.bots.findById(task.botId) : null;

      changes.task(this.repos.tasks.update(taskId, { status: 'paused' }));
      if (bot) {
        // Cancel any walk in progress so it does not arrive and resume working.
        changes.bot(
          this.repos.bots.update(bot.id, { status: 'paused', movement: null }),
        );
      }
      this.log(
        changes,
        'paused',
        `“${task.title}” was paused at ${Math.round(task.progress)}% — progress held`,
        { task, bot, at: Date.now() },
      );
      return changes.build();
    });
  }

  /**
   * Stop this run for good.
   *
   * The task keeps the progress it reached, for the record, and the agent is
   * released. Cancelling is not deleting: the task stays visible.
   */
  cancelTask(taskId: Id): EngineChanges {
    const task = this.requireTask(taskId);
    if (isTerminalTaskStatus(task.status)) {
      throw refuse(`This task is already ${task.status}.`);
    }

    return this.repos.transaction(() => {
      const changes = new ChangeSet();
      const bot = task.botId ? this.repos.bots.findById(task.botId) : null;

      // Nobody should be asked to decide on work that is no longer going anywhere.
      this.withdrawApproval(taskId, 'Task was cancelled', changes);

      changes.task(
        this.repos.tasks.update(taskId, { status: 'cancelled', botId: null, blocker: null }),
      );
      if (bot) this.releaseBot(bot.id, changes);

      this.log(
        changes,
        'cancelled',
        `“${task.title}” was cancelled at ${Math.round(task.progress)}%`,
        { task, bot, at: Date.now() },
      );
      return changes.build();
    });
  }

  /** Put a cancelled or finished task back on the board at 0%. */
  resetTask(taskId: Id): EngineChanges {
    const task = this.requireTask(taskId);
    return this.repos.transaction(() => {
      const changes = new ChangeSet();
      this.withdrawApproval(taskId, 'The task was reset', changes);
      if (task.botId) this.releaseBot(task.botId, changes);
      changes.task(
        this.repos.tasks.update(taskId, {
          status: 'backlog',
          progress: 0,
          botId: null,
          blocker: null,
          startedAt: null,
          completedAt: null,
        }),
      );
      this.log(changes, 'created', `“${task.title}” was reset and put back on the board`, {
        task,
        at: Date.now(),
      });
      return changes.build();
    });
  }

  /** Clear a blocker and put the agent back to work. */
  retryTask(taskId: Id): EngineChanges {
    const task = this.requireTask(taskId);
    if (task.status !== 'failed') throw refuse('Nothing is blocked on this task.');
    if (!task.botId) throw refuse('Assign an agent before retrying.');

    return this.repos.transaction(() => {
      const changes = new ChangeSet();
      const bot = this.repos.bots.findById(task.botId!);

      changes.task(this.repos.tasks.update(taskId, { status: 'working', blocker: null }));
      if (bot) changes.bot(this.repos.bots.update(bot.id, { status: 'working' }));

      this.log(changes, 'retried', `“${task.title}” was retried after the blocker was cleared`, {
        task,
        bot,
        at: Date.now(),
      });
      return changes.build();
    });
  }

  // ── Approvals ─────────────────────────────────────────────────────────────

  /** Sign the work off. The agent carries it to the depot. */
  approve(approvalId: Id): EngineChanges {
    const approval = this.repos.approvals.findById(approvalId);
    if (!approval) throw notFound('Approval request');
    if (approval.status !== 'pending') throw refuse('That request has already been decided.');

    const task = this.repos.tasks.findById(approval.taskId);
    if (!task) throw notFound('Task');
    if (task.status !== 'waiting_approval') {
      throw refuse(`That work is no longer waiting for approval — it is ${task.status}.`);
    }

    return this.repos.transaction(() => {
      const changes = new ChangeSet();
      const bot = this.repos.bots.findById(approval.botId);

      changes.approval(this.repos.approvals.decide(approvalId, 'approved', null));
      changes.task(this.repos.tasks.update(task.id, { status: 'delivering' }));
      // The engine takes it from here: the bot walks to the depot, and arriving
      // is what completes the task and adds the crate.
      if (bot) changes.bot(this.repos.bots.update(bot.id, { status: 'working' }));

      this.log(
        changes,
        'approved',
        `You approved “${task.title}” — ${bot?.name ?? 'the agent'} is delivering it to the ${PLOTS.depot.label}`,
        { task, bot, at: Date.now() },
      );
      return changes.build();
    });
  }

  /** Send the work back. The agent reopens it and keeps going. */
  reject(approvalId: Id, note?: string): EngineChanges {
    const approval = this.repos.approvals.findById(approvalId);
    if (!approval) throw notFound('Approval request');
    if (approval.status !== 'pending') throw refuse('That request has already been decided.');

    const task = this.repos.tasks.findById(approval.taskId);
    if (!task) throw notFound('Task');
    if (task.status !== 'waiting_approval') {
      throw refuse(`That work is no longer waiting for approval — it is ${task.status}.`);
    }

    const trimmed = note?.trim() || null;

    return this.repos.transaction(() => {
      const changes = new ChangeSet();
      const bot = this.repos.bots.findById(approval.botId);

      changes.approval(this.repos.approvals.decide(approvalId, 'rejected', trimmed));
      // Knock progress back so there is real work to redo, rather than the task
      // finishing again on the very next tick.
      const reopenedAt = Math.min(task.progress, 68);
      changes.task(
        this.repos.tasks.update(task.id, { status: 'working', progress: reopenedAt }),
      );
      if (bot) {
        changes.bot(this.repos.bots.update(bot.id, { status: 'working', progress: reopenedAt }));
      }

      this.log(
        changes,
        'rejected',
        `You sent “${task.title}” back for changes${trimmed ? `: ${trimmed}` : ''}`,
        { task, bot, at: Date.now() },
      );
      return changes.build();
    });
  }

  // ── Shared internals ──────────────────────────────────────────────────────

  /**
   * Withdraw a pending approval request.
   *
   * Any path that takes work out of "waiting for approval" without you
   * deciding — cancelling it, reassigning the agent, putting it back on the
   * board — has to come through here. Leaving the request behind would show a
   * card in the queue that can never be approved, because its task has moved on.
   */
  private withdrawApproval(taskId: Id, reason: string, changes: ChangeSet): void {
    const pending = this.repos.approvals.findPendingByTask(taskId);
    if (!pending) return;
    changes.approval(this.repos.approvals.decide(pending.id, 'rejected', reason));
    changes.approvalsDirty();
  }

  private requireTask(id: Id): Task {
    const task = this.repos.tasks.findById(id);
    if (!task) throw notFound('Task');
    return task;
  }

  /**
   * Give a task to an agent.
   *
   * An agent given work on another island travels there. Home is where it
   * returns when idle, not somewhere it is confined to.
   */
  private assignInternal(taskId: Id, botId: Id, changes: ChangeSet): void {
    const task = this.requireTask(taskId);
    const bot = this.repos.bots.findById(botId);
    if (!bot) throw notFound('Agent');

    if (isTerminalTaskStatus(task.status)) {
      throw refuse(`“${task.title}” is already ${task.status}.`);
    }

    // Free whoever is currently holding this task.
    const previous = this.repos.bots.list().find((b) => b.taskId === taskId && b.id !== botId);
    if (previous) this.releaseBot(previous.id, changes);

    // And free whatever this agent was holding, putting it back on the board.
    if (bot.taskId && bot.taskId !== taskId) {
      const old = this.repos.tasks.findById(bot.taskId);
      if (old && !isTerminalTaskStatus(old.status)) {
        // Progress is kept, so work that was finished finishes again straight
        // away and asks for your decision a second time rather than vanishing.
        if (old.status === 'waiting_approval') {
          this.withdrawApproval(
            old.id,
            `${bot.name} was moved to other work before you decided`,
            changes,
          );
          this.log(
            changes,
            'system',
            `“${old.title}” went back on the board — ${bot.name} was reassigned before you decided, so the approval request was withdrawn`,
            { task: old, bot, at: Date.now() },
          );
        }
        changes.task(this.repos.tasks.update(old.id, { botId: null, status: 'backlog' }));
      }
    }

    const now = Date.now();
    const travelling = bot.islandId !== task.islandId;
    const destination = this.repos.islands.findById(task.islandId);

    changes.task(this.repos.tasks.update(taskId, { botId, blocker: null }));
    changes.bot(
      this.repos.bots.update(botId, {
        taskId,
        // A completed or failed agent becomes available again on reassignment.
        ...(bot.status === 'completed' || bot.status === 'failed' ? { status: 'idle' } : {}),
        ...(travelling
          ? // Arrive at the destination's gate and walk from there, so the
            // journey reads as a journey rather than a teleport into a desk.
            { islandId: task.islandId, locationKey: 'gate' as const, movement: null }
          : {}),
        updatedAt: now,
      }),
    );

    if (travelling && destination) {
      this.log(changes, 'arrived', `${bot.name} travelled to ${destination.name}`, {
        task,
        bot,
        at: now,
      });
    }
    this.log(changes, 'assigned', `${bot.name} was assigned “${task.title}”`, {
      task,
      bot,
      at: now,
    });
  }

  private startInternal(taskId: Id, changes: ChangeSet): void {
    const task = this.requireTask(taskId);

    if (task.status === 'working') throw refuse('That task is already running.');
    if (task.status === 'waiting_approval') throw refuse('That work is finished and waiting on you.');
    if (task.status === 'delivering') throw refuse('That work is already on its way to the depot.');
    if (task.status === 'failed') throw refuse('That task is blocked — clear the blocker with Retry.');
    if (isTerminalTaskStatus(task.status)) {
      throw refuse(`That task is ${task.status}. Reset it to run it again.`);
    }

    // Starting unassigned work hands it to the agent that owns this kind of
    // task, rather than refusing over something we can decide correctly.
    let botId = task.botId;
    if (!botId) {
      const preferred = this.repos.bots.findByKey(defaultBotForTaskType(task.type));
      if (!preferred) throw refuse('Assign an agent before starting this task.');
      this.assignInternal(taskId, preferred.id, changes);
      botId = preferred.id;
    }

    const bot = this.repos.bots.findById(botId);
    if (!bot) throw notFound('Agent');

    const resuming = task.status === 'paused';
    const now = Date.now();

    changes.task(
      this.repos.tasks.update(taskId, {
        status: 'working',
        blocker: null,
        ...(task.startedAt === null ? { startedAt: now } : {}),
      }),
    );
    changes.bot(this.repos.bots.update(bot.id, { status: 'working', updatedAt: now }));

    this.log(
      changes,
      resuming ? 'resumed' : 'started',
      resuming
        ? `${bot.name} resumed “${task.title}” at ${Math.round(task.progress)}%`
        : `${bot.name} started “${task.title}”`,
      { task, bot, at: now },
    );
  }

  /** Put an agent back to idle with nothing in hand. */
  private releaseBot(botId: Id, changes: ChangeSet): Bot | null {
    const released = this.repos.bots.update(botId, {
      taskId: null,
      status: 'idle',
      progress: 0,
      updatedAt: Date.now(),
    });
    changes.bot(released);
    return released;
  }

  private log(
    changes: ChangeSet,
    kind: ActivityKind,
    message: string,
    ctx: { task?: Task | null; bot?: Bot | null; projectId?: Id; at: number },
  ): void {
    const event: ActivityEvent = {
      id: newId('evt'),
      kind,
      message,
      projectId: ctx.task?.projectId ?? ctx.projectId ?? null,
      taskId: ctx.task?.id ?? null,
      botId: ctx.bot?.id ?? null,
      islandId: ctx.task?.islandId ?? ctx.bot?.islandId ?? null,
      at: ctx.at,
    };
    this.repos.activity.create(event);
    changes.activity(event);
  }
}

/** Which agent naturally owns a kind of work. Used to suggest, never to force. */
export const preferredBotKeyFor = (type: TaskType) => defaultBotForTaskType(type);

export const botProfileFor = (key: keyof typeof BOT_PROFILES) => BOT_PROFILES[key];
