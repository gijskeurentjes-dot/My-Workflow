import {
  ARCHETYPES,
  TASK_TYPES,
  describeAgent,
  movementState,
  type ActivityEvent,
  type Agent,
  type AgentView,
  type ApprovalStatus,
  type ApprovalView,
  type MilestoneView,
  type UsageReport,
  type UsageSummary,
  type EngineInfo,
  type Id,
  type Project,
  type RuntimeInfo,
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
 * "what an agent looks like to the UI" is defined once. Every join the client
 * would otherwise do — agent to archetype, task to project — is done here.
 */
export class WorldService {
  constructor(
    private readonly repos: Repositories,
    private readonly engine: AgentEngine,
    private readonly activityLimit = 120,
    /**
     * What can be executed for real. Injected rather than imported so the read
     * side stays free of configuration, and so a test can say "no live agents"
     * without touching the environment.
     */
    private readonly runtime: () => RuntimeInfo = () => ({
      available: false,
      credentialsConfigured: false,
      model: '',
      archetypes: [],
      maxSearches: 0,
    }),
  ) {}

  /** Everything needed to render the app, in one payload. */
  snapshot(): WorldSnapshot {
    const projects = this.repos.projects.list();
    const agents = this.repos.agents.list();
    const tasks = this.repos.tasks.list();

    return {
      projects,
      agents,
      tasks,
      milestones: this.repos.milestones.list(),
      files: this.repos.files.list(),
      approvals: this.repos.approvals.list(),
      activity: this.repos.activity.list({ limit: this.activityLimit }),
      stats: this.statsFrom(agents, tasks, projects),
      serverTime: Date.now(),
      engine: this.engineInfo(),
      runtime: this.runtime(),
    };
  }

  stats(): WorldStats {
    return this.statsFrom(
      this.repos.agents.list(),
      this.repos.tasks.list(),
      this.repos.projects.list(),
    );
  }

  private statsFrom(agents: Agent[], tasks: Task[], projects: Project[]): WorldStats {
    return {
      projects: projects.filter((p) => p.status === 'active').length,
      agents: agents.length,
      agentsWorking: agents.filter((a) => a.status === 'working').length,
      agentsIdle: agents.filter((a) => a.status === 'idle').length,
      tasksOpen: tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length,
      tasksCompleted: tasks.filter((t) => t.status === 'completed').length,
      approvalsPending: this.repos.approvals.list({ status: 'pending' }).length,
    };
  }

  engineInfo(): EngineInfo {
    return this.engine.info();
  }

  // ── Agents ────────────────────────────────────────────────────────────────

  listAgentViews(projectId?: Id): AgentView[] {
    const agents = projectId
      ? this.repos.agents.findByProject(projectId)
      : this.repos.agents.list();
    return agents.map((agent) => this.toAgentView(agent));
  }

  findAgentView(id: Id): AgentView | null {
    const agent = this.repos.agents.findById(id);
    return agent ? this.toAgentView(agent) : null;
  }

  private toAgentView(agent: Agent): AgentView {
    const project = this.repos.projects.findById(agent.projectId);
    if (!project) throw new Error(`Agent ${agent.id} references a missing project`);
    const task = agent.currentTaskId ? this.repos.tasks.findById(agent.currentTaskId) : null;

    // Rotating the thought line off the clock keeps a working agent from
    // looking frozen, without storing a counter that would churn the database.
    const thoughtIndex = Math.floor(Date.now() / 6000);

    return {
      ...agent,
      profile: ARCHETYPES[agent.archetype],
      project,
      task,
      movementState: movementState(agent),
      doing: describeAgent(agent, task, thoughtIndex),
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
    if (!project) throw new Error(`Task ${task.id} references a missing project`);
    const agent = task.assignedAgentId ? this.repos.agents.findById(task.assignedAgentId) : null;

    return {
      ...task,
      project: { id: project.id, name: project.name, color: project.color },
      agent: agent ? { id: agent.id, archetype: agent.archetype, name: agent.name } : null,
      typeInfo: TASK_TYPES[task.type],
    };
  }

  // ── Approvals ─────────────────────────────────────────────────────────────

  /**
   * Milestones with the work counted up.
   *
   * "Nine tasks open" tells you nothing; "the IC pack is two tasks from done"
   * is the thing a person actually wants, so the counting happens here rather
   * than in every screen that shows a milestone.
   */
  listMilestoneViews(projectId?: Id): MilestoneView[] {
    const tasks = this.repos.tasks.list(projectId ? { projectId } : undefined);
    const now = Date.now();

    return this.repos.milestones.list(projectId).map((milestone) => {
      const mine = tasks.filter((t) => t.milestoneId === milestone.id);
      const completed = mine.filter((t) => t.status === 'completed').length;
      return {
        ...milestone,
        taskCount: mine.length,
        completedCount: completed,
        percent: mine.length === 0 ? 0 : Math.round((completed / mine.length) * 100),
        overdue: milestone.status === 'open' && milestone.dueAt !== null && milestone.dueAt < now,
      };
    });
  }

  /**
   * What live runs have cost, by agent and by project.
   *
   * Only real runs appear here: the simulation costs nothing, and a number
   * that quietly mixed the two would be worse than no number at all.
   */
  usage(): UsageReport {
    const perAgent = this.repos.results.usageByAgent();
    const agents = new Map(this.repos.agents.list().map((a) => [a.id, a]));
    const projects = new Map(this.repos.projects.list().map((p) => [p.id, p]));

    const byAgent = perAgent
      .map((row) => {
        const agent = agents.get(row.agentId);
        if (!agent) return null;
        return {
          agentId: agent.id,
          name: agent.name,
          projectId: agent.projectId,
          usage: row.usage,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => b.usage.outputTokens - a.usage.outputTokens);

    const projectTotals = new Map<Id, UsageSummary>();
    for (const row of byAgent) {
      const running = projectTotals.get(row.projectId) ?? emptyUsage();
      projectTotals.set(row.projectId, addUsage(running, row.usage));
    }

    return {
      total: this.repos.results.totalUsage(),
      byAgent,
      byProject: [...projectTotals.entries()]
        .map(([projectId, usage]) => ({
          projectId,
          name: projects.get(projectId)?.name ?? 'Unknown project',
          usage,
        }))
        .sort((a, b) => b.usage.outputTokens - a.usage.outputTokens),
    };
  }

  listApprovalViews(status?: ApprovalStatus): ApprovalView[] {
    return this.repos.approvals
      .list(status ? { status } : undefined)
      .map((request) => {
        const task = this.repos.tasks.findById(request.taskId);
        const agent = this.repos.agents.findById(request.agentId);
        if (!task || !agent) return null;
        const project = this.repos.projects.findById(task.projectId);
        if (!project) return null;

        return {
          ...request,
          task: { id: task.id, title: task.title, type: task.type, projectId: task.projectId },
          agent: { id: agent.id, archetype: agent.archetype, name: agent.name },
          project: { id: project.id, name: project.name, color: project.color },
        } satisfies ApprovalView;
      })
      // A request whose task or agent has been deleted is history, not a row
      // the approval queue can act on.
      .filter((v): v is ApprovalView => v !== null);
  }

  // ── Activity ──────────────────────────────────────────────────────────────

  listActivity(filter: Parameters<Repositories['activity']['list']>[0] = {}): ActivityEvent[] {
    return this.repos.activity.list({ limit: this.activityLimit, ...filter });
  }
}

const emptyUsage = (): UsageSummary => ({
  runs: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  webSearches: 0,
  durationMs: 0,
  lastRunAt: null,
});

const addUsage = (a: UsageSummary, b: UsageSummary): UsageSummary => ({
  runs: a.runs + b.runs,
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  webSearches: a.webSearches + b.webSearches,
  durationMs: a.durationMs + b.durationMs,
  // The later of the two: "last run" means the most recent one, either side.
  lastRunAt:
    a.lastRunAt === null || b.lastRunAt === null
      ? (a.lastRunAt ?? b.lastRunAt)
      : Math.max(a.lastRunAt, b.lastRunAt),
});
