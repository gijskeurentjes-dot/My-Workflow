import {
  ARCHETYPES,
  TASK_TYPES,
  describeAgent,
  movementState,
  type ActivityEvent,
  type Agent,
  type AgentView,
  type ApprovalView,
  type EngineInfo,
  type Id,
  type Project,
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
      approvals: this.repos.approvals.list(),
      activity: this.repos.activity.list({ limit: this.activityLimit }),
      stats: this.statsFrom(agents, tasks, projects),
      serverTime: Date.now(),
      engine: this.engineInfo(),
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

  listApprovalViews(status?: 'pending' | 'approved' | 'rejected'): ApprovalView[] {
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
