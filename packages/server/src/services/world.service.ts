import {
  BOT_PROFILES,
  TASK_TYPES,
  describeBot,
  movementState,
  type ActivityEvent,
  type ApprovalView,
  type Bot,
  type BotView,
  type EngineInfo,
  type Id,
  type Task,
  type TaskView,
  type WorldSnapshot,
  type WorldStats,
} from '@ai-islands/shared';
import type { Repositories } from '../repositories/types.js';
import type { AgentEngine } from './agents/agent-engine.js';

/**
 * The read side of the world.
 *
 * Routes ask this for shaped data rather than reaching into repositories, so
 * "what a bot looks like to the UI" is defined once. Every join the client
 * would otherwise do — bot to profile, task to project — is done here.
 */
export class WorldService {
  constructor(
    private readonly repos: Repositories,
    private readonly engine: AgentEngine,
    private readonly activityLimit = 120,
  ) {}

  /** Everything needed to render the app, in one payload. */
  snapshot(): WorldSnapshot {
    const islands = this.repos.islands.list();
    const bots = this.repos.bots.list();
    const projects = this.repos.projects.list();
    const tasks = this.repos.tasks.list();
    const approvals = this.repos.approvals.list();
    const activity = this.repos.activity.list({ limit: this.activityLimit });

    return {
      islands,
      bots,
      projects,
      tasks,
      approvals,
      activity,
      stats: this.statsFrom(bots, tasks, projects, islands.length),
      serverTime: Date.now(),
      engine: this.engineInfo(),
    };
  }

  stats(): WorldStats {
    return this.statsFrom(
      this.repos.bots.list(),
      this.repos.tasks.list(),
      this.repos.projects.list(),
      this.repos.islands.list().length,
    );
  }

  private statsFrom(
    bots: Bot[],
    tasks: Task[],
    projects: { status: string }[],
    islandCount: number,
  ): WorldStats {
    return {
      islands: islandCount,
      bots: bots.length,
      botsWorking: bots.filter((b) => b.status === 'working').length,
      botsIdle: bots.filter((b) => b.status === 'idle').length,
      projects: projects.filter((p) => p.status === 'active').length,
      tasksOpen: tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length,
      tasksCompleted: tasks.filter((t) => t.status === 'completed').length,
      approvalsPending: this.repos.approvals.list({ status: 'pending' }).length,
    };
  }

  engineInfo(): EngineInfo {
    return this.engine.info();
  }

  // ── Bots ──────────────────────────────────────────────────────────────────

  listBotViews(): BotView[] {
    return this.repos.bots.list().map((bot) => this.toBotView(bot));
  }

  findBotView(id: Id): BotView | null {
    const bot = this.repos.bots.findById(id);
    return bot ? this.toBotView(bot) : null;
  }

  private toBotView(bot: Bot): BotView {
    const island = this.repos.islands.findById(bot.islandId);
    if (!island) throw new Error(`Bot ${bot.id} references a missing island`);
    const task = bot.taskId ? this.repos.tasks.findById(bot.taskId) : null;

    // Rotating the thought line off the clock keeps a working bot from looking
    // frozen, without storing a counter that would churn the database.
    const thoughtIndex = Math.floor(Date.now() / 6000);

    return {
      ...bot,
      profile: BOT_PROFILES[bot.key],
      island,
      task,
      movementState: movementState(bot),
      doing: describeBot(bot, task, thoughtIndex),
    };
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────

  listTaskViews(filter: Parameters<Repositories['tasks']['list']>[0] = {}): TaskView[] {
    return this.repos.tasks.list(filter).map((task) => this.toTaskView(task));
  }

  findTaskView(id: Id): TaskView | null {
    const task = this.repos.tasks.findById(id);
    return task ? this.toTaskView(task) : null;
  }

  private toTaskView(task: Task): TaskView {
    const project = this.repos.projects.findById(task.projectId);
    const island = this.repos.islands.findById(task.islandId);
    if (!project || !island) throw new Error(`Task ${task.id} references missing rows`);
    const bot = task.botId ? this.repos.bots.findById(task.botId) : null;

    return {
      ...task,
      project: { id: project.id, name: project.name, color: project.color },
      island: { id: island.id, key: island.key, name: island.name },
      bot: bot ? { id: bot.id, key: bot.key, name: bot.name } : null,
      typeInfo: TASK_TYPES[task.type],
    };
  }

  // ── Approvals ─────────────────────────────────────────────────────────────

  listApprovalViews(status?: 'pending' | 'approved' | 'rejected'): ApprovalView[] {
    return this.repos.approvals
      .list(status ? { status } : undefined)
      .map((request) => {
        const task = this.repos.tasks.findById(request.taskId);
        const bot = this.repos.bots.findById(request.botId);
        if (!task || !bot) return null;
        const project = this.repos.projects.findById(task.projectId);
        if (!project) return null;

        return {
          ...request,
          task: { id: task.id, title: task.title, type: task.type, projectId: task.projectId },
          bot: { id: bot.id, key: bot.key, name: bot.name },
          project: { id: project.id, name: project.name, color: project.color },
        } satisfies ApprovalView;
      })
      // A request whose task or bot has been deleted is history, not a row the
      // approval queue can act on.
      .filter((v): v is ApprovalView => v !== null);
  }

  // ── Activity ──────────────────────────────────────────────────────────────

  listActivity(filter: Parameters<Repositories['activity']['list']>[0] = {}): ActivityEvent[] {
    return this.repos.activity.list({ limit: this.activityLimit, ...filter });
  }
}
