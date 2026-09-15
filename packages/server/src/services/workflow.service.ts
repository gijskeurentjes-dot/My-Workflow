import {
  ARCHETYPES,
  ARCHETYPE_KEYS,
  APPROVAL_PLOT,
  DEAL_AGENT_LIST,
  DEAL_ROOM_TEMPLATE,
  DELIVERY_PLOT,
  PLOTS,
  PROJECT_TEMPLATES,
  TASK_TYPES,
  appearanceForIndex,
  archetypeForTaskType,
  dealAgentInstructions,
  defaultInstructions,
  homePlotFor,
  isTerminalTaskStatus,
  type ActivityEvent,
  type ActivityEventType,
  type Agent,
  type AgentArchetype,
  type DealAgentDefinition,
  type Id,
  type Project,
  type ProjectTemplate,
  type Task,
  type TaskPriority,
  type TaskType,
} from '@ai-islands/shared';
import { invalid, notFound, refuse } from '../errors.js';
import { newId } from '../ids.js';
import type { Repositories } from '../repositories/types.js';
import { ChangeSet, type EngineChanges } from './agents/agent-engine.js';
import type { ApprovalGateRegistry } from './approval-gates.js';
import { RESEARCH_DEFAULTS } from './agents/claude/nova.js';
import { DEFAULT_AGENT_MODEL } from '../config.js';

/**
 * Everything a person can ask the world to do.
 *
 * The agent engine advances work on its own; this service is the other half —
 * the commands you issue. Both write through the same repositories and report
 * what changed the same way, so a task started by hand and a task picked up
 * automatically are indistinguishable downstream.
 *
 * Every rule about which transition is legal lives here. Routes only translate
 * HTTP into a call, and the UI disables buttons as a courtesy — the refusal is
 * enforced on this side.
 */
export class WorkflowService {
  /**
   * Runs that are stopped, waiting for a decision.
   *
   * Injected after construction because the execution service owns the
   * registry and is built later; when it is absent — a test with no live
   * runtime — every approval is simply a piece of finished work.
   */
  private gates: ApprovalGateRegistry | null = null;

  useGates(gates: ApprovalGateRegistry): void {
    this.gates = gates;
  }

  constructor(private readonly repos: Repositories) {}

  // ── Projects ──────────────────────────────────────────────────────────────

  /**
   * Create a project, which is also creating its island.
   *
   * A project with nobody on it can never do anything, so one is hired by
   * default. Pass an explicit `team` to start with a different shape.
   */
  createProject(input: {
    name?: string;
    description?: string;
    color?: string;
    team?: AgentArchetype[];
    /** Which kind of project. A deal room brings its own fixed team. */
    template?: ProjectTemplate;
  }): { project: Project; changes: EngineChanges } {
    const template: ProjectTemplate = input.template ?? 'standard';
    if (!PROJECT_TEMPLATES.includes(template)) {
      throw invalid(`Unknown kind of project: ${template}`);
    }

    const dealRoom = template === 'deal_room';
    const name = input.name?.trim() || (dealRoom ? DEAL_ROOM_TEMPLATE.defaultName : '');
    if (!name) throw invalid('A project needs a name.');

    // A deal room's team is the registry, not a choice. Silently ignoring a
    // team someone asked for would be worse than saying why it cannot apply.
    if (dealRoom && input.team && input.team.length > 0) {
      throw invalid(
        'A deal room always has the same five agents — Atlas, Nova, Forge, Ledger and Canvas — so its team cannot be chosen.',
      );
    }

    const team = input.team ?? ['pm'];
    for (const archetype of team) {
      if (!ARCHETYPES[archetype]) throw invalid(`Unknown kind of agent: ${archetype}`);
    }

    return this.repos.transaction(() => {
      const now = Date.now();
      const project = this.repos.projects.create({
        id: newId('prj'),
        name,
        description:
          input.description?.trim() ||
          (dealRoom ? DEAL_ROOM_TEMPLATE.defaultDescription : ''),
        status: 'active',
        template,
        color: input.color ?? (dealRoom ? DEAL_ROOM_TEMPLATE.color : '#4a8ff0'),
        // Derived from how many projects exist, so consecutive islands look
        // different and the same nth project always draws the same shape.
        appearance: appearanceForIndex(this.repos.projects.count()),
        crates: 0,
        createdAt: now,
        updatedAt: now,
      });

      const changes = new ChangeSet();
      changes.projects();
      this.log(changes, 'created', `Project “${project.name}” was created`, {
        projectId: project.id,
        at: now,
      });

      if (dealRoom) {
        // The five, in registry order, each with the brief and the tool list
        // its definition carries. Nobody else can ever join.
        for (const definition of DEAL_AGENT_LIST) {
          this.hireInternal(project, definition.archetype, definition.name, changes, now, definition);
        }
      } else {
        for (const archetype of team) {
          this.hireInternal(project, archetype, undefined, changes, now);
        }
      }

      return { project, changes: changes.build() };
    });
  }

  updateProject(
    id: Id,
    patch: { name?: string; description?: string; status?: Project['status']; color?: string },
  ): { project: Project; changes: EngineChanges } {
    const existing = this.repos.projects.findById(id);
    if (!existing) throw notFound('Project');
    if (patch.name !== undefined && !patch.name.trim()) throw invalid('A project needs a name.');

    return this.repos.transaction(() => {
      const project = this.repos.projects.update(id, {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
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

  /** Delete a project, its island, its team and all of its work. */
  deleteProject(id: Id): EngineChanges {
    const project = this.repos.projects.findById(id);
    if (!project) throw notFound('Project');

    return this.repos.transaction(() => {
      const changes = new ChangeSet();
      changes.projects();
      // Cascades handle the rows; the flags are what refresh open screens.
      for (const task of this.repos.tasks.list({ projectId: id })) {
        if (this.repos.approvals.findPendingByTask(task.id)) changes.approvalsDirty();
      }
      this.repos.projects.delete(id);
      this.log(
        changes,
        'system',
        `Project “${project.name}”, its team and its tasks were deleted`,
        { at: Date.now() },
      );
      return changes.build();
    });
  }

  // ── Agents ────────────────────────────────────────────────────────────────

  /** Add an agent to a project's team. */
  hireAgent(
    projectId: Id,
    archetype: AgentArchetype,
    name?: string,
  ): { agent: Agent; changes: EngineChanges } {
    const project = this.repos.projects.findById(projectId);
    if (!project) throw notFound('Project');
    // The registry is the whole point of a deal room: five named specialists,
    // fixed, so that who did what is never in question. Refused here rather
    // than in a prompt, because a rule an agent could talk its way past is not
    // a rule.
    if (project.template === 'deal_room') {
      throw refuse(
        `${project.name} has a fixed team of five — Atlas, Nova, Forge, Ledger and Canvas. No one else can be hired onto it.`,
      );
    }
    if (!ARCHETYPES[archetype]) {
      throw invalid(`Unknown kind of agent: ${archetype}. Expected one of ${ARCHETYPE_KEYS.join(', ')}.`);
    }

    return this.repos.transaction(() => {
      const changes = new ChangeSet();
      const agent = this.hireInternal(project, archetype, name, changes, Date.now());
      return { agent, changes: changes.build() };
    });
  }

  /** Remove an agent. Anything it was holding goes back on the board. */
  dismissAgent(id: Id): EngineChanges {
    const agent = this.repos.agents.findById(id);
    if (!agent) throw notFound('Agent');

    const project = this.repos.projects.findById(agent.projectId);
    if (project?.template === 'deal_room') {
      throw refuse(
        `${agent.name} is part of the fixed deal-room team on ${project.name} and cannot be dismissed.`,
      );
    }

    return this.repos.transaction(() => {
      const changes = new ChangeSet();

      const held = agent.currentTaskId ? this.repos.tasks.findById(agent.currentTaskId) : null;
      if (held && !isTerminalTaskStatus(held.status)) {
        this.withdrawApproval(held.id, `${agent.name} left the project`, changes);
        changes.task(
          this.repos.tasks.update(held.id, {
            assignedAgentId: null,
            status: 'backlog',
            blocker: null,
          }),
        );
      }

      this.repos.agents.delete(id);
      this.log(changes, 'dismissed', `${agent.name} left the project`, {
        projectId: agent.projectId,
        at: Date.now(),
      });
      return changes.build();
    });
  }

  /**
   * Edit an agent's brief.
   *
   * `instructions` is what a real engine sends as this agent's system prompt
   * and `tools` is what it may reach for, so this is where you shape an agent's
   * behaviour. Storing it rather than hardcoding it is what lets the brief
   * change without a deploy.
   */
  updateAgent(
    id: Id,
    patch: { name?: string; role?: string; instructions?: string; tools?: string[] },
  ): { agent: Agent; changes: EngineChanges } {
    const existing = this.repos.agents.findById(id);
    if (!existing) throw notFound('Agent');
    if (patch.name !== undefined && !patch.name.trim()) throw invalid('An agent needs a name.');

    return this.repos.transaction(() => {
      const agent = this.repos.agents.update(id, {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.role !== undefined ? { role: patch.role.trim() } : {}),
        ...(patch.instructions !== undefined ? { instructions: patch.instructions.trim() } : {}),
        ...(patch.tools !== undefined
          ? { tools: patch.tools.map((t) => t.trim()).filter(Boolean) }
          : {}),
      });
      if (!agent) throw notFound('Agent');

      const changes = new ChangeSet();
      changes.agent(agent);

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
        this.log(
          changes,
          'system',
          `${agent.name}’s ${edited.join(' and ')} ${edited.length > 1 ? 'were' : 'was'} updated`,
          { agent, at: Date.now() },
        );
      }

      return { agent, changes: changes.build() };
    });
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────

  createTask(input: {
    projectId: Id;
    title: string;
    description?: string;
    type: TaskType;
    priority?: TaskPriority;
    needsApproval?: boolean;
    agentId?: Id | null;
    autoStart?: boolean;
  }): { task: Task; changes: EngineChanges } {
    const project = this.repos.projects.findById(input.projectId);
    if (!project) throw notFound('Project');

    const title = input.title?.trim();
    if (!title) throw invalid('A task needs a title.');
    if (!TASK_TYPES[input.type]) throw invalid(`Unknown kind of work: ${input.type}`);

    return this.repos.transaction(() => {
      const now = Date.now();
      const task = this.repos.tasks.create({
        id: newId('tsk'),
        projectId: project.id,
        assignedAgentId: null,
        title,
        description: input.description?.trim() ?? '',
        type: input.type,
        status: 'backlog',
        priority: input.priority ?? 'normal',
        // The kind of work decides where it happens. That mapping is not
        // optional — it is what makes the island legible.
        buildingKey: TASK_TYPES[input.type].building,
        progress: 0,
        runMode: 'simulated',
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

      if (input.agentId) {
        this.assignInternal(task.id, input.agentId, changes);
        if (input.autoStart) this.startInternal(task.id, changes);
      }

      return { task: this.repos.tasks.findById(task.id) ?? task, changes: changes.build() };
    });
  }

  updateTask(
    id: Id,
    patch: {
      title?: string;
      description?: string;
      needsApproval?: boolean;
      priority?: TaskPriority;
    },
  ): { task: Task; changes: EngineChanges } {
    const task = this.requireTask(id);
    if (patch.title !== undefined && !patch.title.trim()) throw invalid('A task needs a title.');

    return this.repos.transaction(() => {
      const changes = new ChangeSet();

      if (patch.needsApproval !== undefined && patch.needsApproval !== task.needsApproval) {
        // Changing this once the work is already waiting would strand a request
        // that is waiting on a human decision.
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
        this.log(changes, 'system', `“${task.title}” was moved to ${patch.priority} priority`, {
          task,
          at: Date.now(),
        });
      }

      const updated = this.repos.tasks.update(id, {
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
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
      if (task.assignedAgentId) this.releaseAgent(task.assignedAgentId, changes);
      this.repos.tasks.delete(id);
      this.log(changes, 'system', `“${task.title}” was deleted`, {
        projectId: task.projectId,
        at: Date.now(),
      });
      return changes.build();
    });
  }

  // ── Running work ──────────────────────────────────────────────────────────

  assignTask(taskId: Id, agentId: Id): EngineChanges {
    return this.repos.transaction(() => {
      const changes = new ChangeSet();
      this.assignInternal(taskId, agentId, changes);
      return changes.build();
    });
  }

  /** Take the task off whoever holds it and put it back on the board. */
  unassignTask(taskId: Id): EngineChanges {
    const task = this.requireTask(taskId);
    if (!task.assignedAgentId) throw refuse('Nobody is holding this task.');

    return this.repos.transaction(() => {
      const changes = new ChangeSet();
      const agent = this.repos.agents.findById(task.assignedAgentId!);
      this.withdrawApproval(taskId, 'The task was taken off its agent', changes);
      this.releaseAgent(task.assignedAgentId!, changes);
      changes.task(
        this.repos.tasks.update(taskId, {
          assignedAgentId: null,
          status: 'backlog',
          blocker: null,
        }),
      );
      this.log(changes, 'assigned', `“${task.title}” went back on the board`, {
        task,
        agent,
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
      const agent = task.assignedAgentId ? this.repos.agents.findById(task.assignedAgentId) : null;

      changes.task(this.repos.tasks.update(taskId, { status: 'paused' }));
      if (agent) {
        // Cancel any walk in progress so it does not arrive and resume working.
        changes.agent(this.repos.agents.update(agent.id, { status: 'paused', movement: null }));
      }
      this.log(
        changes,
        'paused',
        `“${task.title}” was paused at ${Math.round(task.progress)}% — progress held`,
        { task, agent, at: Date.now() },
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
    if (isTerminalTaskStatus(task.status)) throw refuse(`This task is already ${task.status}.`);

    return this.repos.transaction(() => {
      const changes = new ChangeSet();
      const agent = task.assignedAgentId ? this.repos.agents.findById(task.assignedAgentId) : null;

      // Nobody should be asked to decide on work that is no longer going anywhere.
      this.withdrawApproval(taskId, 'Task was cancelled', changes);

      changes.task(
        this.repos.tasks.update(taskId, {
          status: 'cancelled',
          assignedAgentId: null,
          blocker: null,
        }),
      );
      if (agent) this.releaseAgent(agent.id, changes);

      this.log(
        changes,
        'cancelled',
        `“${task.title}” was cancelled at ${Math.round(task.progress)}%`,
        { task, agent, at: Date.now() },
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
      if (task.assignedAgentId) this.releaseAgent(task.assignedAgentId, changes);
      changes.task(
        this.repos.tasks.update(taskId, {
          status: 'backlog',
          progress: 0,
          // Back on the board is back to the simulation until someone runs it
          // for real again: the row always says how *this* attempt is produced.
          runMode: 'simulated',
          assignedAgentId: null,
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
    if (!task.assignedAgentId) throw refuse('Assign an agent before retrying.');

    return this.repos.transaction(() => {
      const changes = new ChangeSet();
      const agent = this.repos.agents.findById(task.assignedAgentId!);

      // A retry from the board is a simulated attempt; retrying a live run is
      // done by running it again, which sets the mode back itself.
      changes.task(
        this.repos.tasks.update(taskId, { status: 'working', runMode: 'simulated', blocker: null }),
      );
      if (agent) changes.agent(this.repos.agents.update(agent.id, { status: 'working' }));

      this.log(changes, 'retried', `“${task.title}” was retried after the blocker was cleared`, {
        task,
        agent,
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
      const agent = this.repos.agents.findById(approval.agentId);

      changes.approval(this.repos.approvals.decide(approvalId, 'approved', null));

      // A blocking request is a run stopped mid-action. Approving releases it
      // to carry on: the execution service moves the task and the agent back
      // to working, because it is the thing that knows the run resumed.
      if (approval.blocking && !this.gates?.isOpen(approvalId)) {
        throw refuse(
          'The run that asked this is no longer going, so there is nothing to let carry on. Retry the task instead.',
        );
      }

      if (approval.blocking && this.gates?.settle(approvalId, 'approved')) {
        this.log(
          changes,
          'approved',
          `You approved: ${agent?.name ?? 'the agent'} may ${approval.action.charAt(0).toLowerCase()}${approval.action.slice(1)}`,
          { task, agent, at: Date.now() },
        );
        return changes.build();
      }

      changes.task(this.repos.tasks.update(task.id, { status: 'delivering' }));
      // The engine takes it from here: the agent walks to the depot, and
      // arriving is what completes the task and adds the crate.
      if (agent) changes.agent(this.repos.agents.update(agent.id, { status: 'working' }));

      this.log(
        changes,
        'approved',
        `You approved “${task.title}” — ${agent?.name ?? 'the agent'} is delivering it to the ${PLOTS[DELIVERY_PLOT].label}`,
        { task, agent, at: Date.now() },
      );
      return changes.build();
    });
  }

  /**
   * Withdraw a request without deciding it, and call the work off.
   *
   * Not a rejection: nobody judged the action, the task simply is not going
   * ahead. Keeping the two apart is what lets the audit log answer "what did
   * you decide" separately from "what happened to this work".
   */
  cancelApproval(approvalId: Id, note?: string): EngineChanges {
    const approval = this.repos.approvals.findById(approvalId);
    if (!approval) throw notFound('Approval request');
    if (approval.status !== 'pending') throw refuse('That request has already been decided.');

    const task = this.repos.tasks.findById(approval.taskId);
    if (!task) throw notFound('Task');

    const reason = note?.trim() || 'You cancelled this request.';

    return this.repos.transaction(() => {
      const changes = new ChangeSet();
      const agent = this.repos.agents.findById(approval.agentId);

      changes.approval(this.repos.approvals.decide(approvalId, 'cancelled', reason));

      // Releasing the gate aborts the run; the execution service then records
      // the task as cancelled, so this must not also try to move it.
      const released = approval.blocking && (this.gates?.settle(approvalId, 'cancelled') ?? false);

      if (!released && !isTerminalTaskStatus(task.status)) {
        changes.task(
          this.repos.tasks.update(task.id, {
            status: 'cancelled',
            assignedAgentId: null,
            blocker: null,
          }),
        );
        if (agent) this.releaseAgent(agent.id, changes);
      }

      this.log(
        changes,
        'cancelled',
        `You cancelled the request on “${task.title}” — the work stops here`,
        { task, agent, at: Date.now() },
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

    if (approval.blocking && !this.gates?.isOpen(approvalId)) {
      throw refuse(
        'The run that asked this is no longer going, so there is nothing left to refuse. Cancel the request instead.',
      );
    }

    const trimmed = note?.trim() || null;

    return this.repos.transaction(() => {
      const changes = new ChangeSet();
      const agent = this.repos.agents.findById(approval.agentId);

      changes.approval(this.repos.approvals.decide(approvalId, 'rejected', trimmed));

      // A refused action is not a refused deliverable: the run carries on, it
      // simply does not get to do the thing it asked about. The execution
      // service puts the agent back to work and records the refusal.
      if (approval.blocking && this.gates?.settle(approvalId, 'rejected')) {
        this.log(
          changes,
          'rejected',
          `You refused: ${agent?.name ?? 'the agent'} may not ${approval.action.charAt(0).toLowerCase()}${approval.action.slice(1)}${trimmed ? ` — ${trimmed}` : ''}`,
          { task, agent, at: Date.now() },
        );
        return changes.build();
      }

      // Knock progress back so there is real work to redo, rather than the task
      // finishing again on the very next tick.
      const reopenedAt = Math.min(task.progress, 68);
      changes.task(this.repos.tasks.update(task.id, { status: 'working', progress: reopenedAt }));
      if (agent) {
        changes.agent(
          this.repos.agents.update(agent.id, { status: 'working', progress: reopenedAt }),
        );
      }

      this.log(
        changes,
        'rejected',
        `You sent “${task.title}” back for changes${trimmed ? `: ${trimmed}` : ''}`,
        { task, agent, at: Date.now() },
      );
      return changes.build();
    });
  }

  // ── Shared internals ──────────────────────────────────────────────────────

  private requireTask(id: Id): Task {
    const task = this.repos.tasks.findById(id);
    if (!task) throw notFound('Task');
    return task;
  }

  private hireInternal(
    project: Project,
    archetype: AgentArchetype,
    name: string | undefined,
    changes: ChangeSet,
    now: number,
    /** A deal-room definition, when this agent comes from the registry. */
    definition?: DealAgentDefinition,
  ): Agent {
    const profile = ARCHETYPES[archetype];
    const trimmed = name?.trim();

    const agent = this.repos.agents.create({
      id: newId('agt'),
      projectId: project.id,
      archetype,
      name: trimmed || profile.defaultName,
      role: definition ? definition.role : profile.title,
      // The brief a real engine would send as this agent's system prompt.
      // A deal-room agent's is built from its registry entry — its
      // permissions, its restrictions and the rules everyone there works
      // under. Everyone else starts from their archetype. Editable after.
      instructions: definition ? dealAgentInstructions(definition) : defaultInstructions(profile),
      tools: definition ? [...definition.tools] : [...profile.tools],
      // Execution limits travel with the agent, so a run has a ceiling
      // even if nobody thought about it when the agent was hired.
      model: DEFAULT_AGENT_MODEL,
      maxExecutionMs: RESEARCH_DEFAULTS.maxExecutionMs,
      maxOutputTokens: RESEARCH_DEFAULTS.maxOutputTokens,
      requiresApproval: RESEARCH_DEFAULTS.requiresApproval,
      status: 'idle',
      currentTaskId: null,
      currentLocation: homePlotFor(archetype),
      movement: null,
      progress: 0,
      createdAt: now,
      updatedAt: now,
    });

    changes.agent(agent);
    this.log(changes, 'hired', `${agent.name} joined ${project.name} as ${agent.role}`, {
      agent,
      projectId: project.id,
      at: now,
    });
    return agent;
  }

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
    // Withdrawn, not rejected: nobody decided anything, the question went away.
    changes.approval(this.repos.approvals.decide(pending.id, 'cancelled', reason));
    changes.approvalsDirty();
    this.gates?.settle(pending.id, 'cancelled');
  }

  /**
   * Give a task to an agent.
   *
   * An agent from another project transfers to this one. Teams are meaningful,
   * so the move is explicit in the log rather than silent — but it is allowed,
   * because refusing would leave you with no way to lend someone out.
   */
  private assignInternal(taskId: Id, agentId: Id, changes: ChangeSet): void {
    const task = this.requireTask(taskId);
    const agent = this.repos.agents.findById(agentId);
    if (!agent) throw notFound('Agent');

    if (isTerminalTaskStatus(task.status)) {
      throw refuse(`“${task.title}” is already ${task.status}.`);
    }

    // Free whoever is currently holding this task.
    const previous = this.repos.agents
      .list()
      .find((a) => a.currentTaskId === taskId && a.id !== agentId);
    if (previous) this.releaseAgent(previous.id, changes);

    // And free whatever this agent was holding, putting it back on the board.
    if (agent.currentTaskId && agent.currentTaskId !== taskId) {
      const old = this.repos.tasks.findById(agent.currentTaskId);
      if (old && !isTerminalTaskStatus(old.status)) {
        // Progress is kept, so work that was finished finishes again straight
        // away and asks for your decision a second time rather than vanishing.
        if (old.status === 'waiting_approval') {
          this.withdrawApproval(
            old.id,
            `${agent.name} was moved to other work before you decided`,
            changes,
          );
          this.log(
            changes,
            'system',
            `“${old.title}” went back on the board — ${agent.name} was reassigned before you decided, so the approval request was withdrawn`,
            { task: old, agent, at: Date.now() },
          );
        }
        changes.task(
          this.repos.tasks.update(old.id, { assignedAgentId: null, status: 'backlog' }),
        );
      }
    }

    const now = Date.now();
    const transferring = agent.projectId !== task.projectId;
    const destination = transferring ? this.repos.projects.findById(task.projectId) : null;

    changes.task(this.repos.tasks.update(taskId, { assignedAgentId: agentId, blocker: null }));
    changes.agent(
      this.repos.agents.update(agentId, {
        currentTaskId: taskId,
        // A completed or failed agent becomes available again on reassignment.
        ...(agent.status === 'completed' || agent.status === 'failed'
          ? { status: 'idle' as const }
          : {}),
        ...(transferring
          ? // Arrive at the destination's gate and walk in, so the journey
            // reads as a journey rather than a teleport into a desk.
            { projectId: task.projectId, currentLocation: 'gate' as const, movement: null }
          : {}),
        updatedAt: now,
      }),
    );

    if (transferring && destination) {
      this.log(changes, 'arrived', `${agent.name} transferred to ${destination.name}`, {
        task,
        agent,
        at: now,
      });
    }
    this.log(changes, 'assigned', `${agent.name} was assigned “${task.title}”`, {
      task,
      agent,
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

    // Starting unassigned work hands it to whoever on this project owns that
    // kind of task, rather than refusing over something we can decide.
    let agentId = task.assignedAgentId;
    if (!agentId) {
      const wanted = archetypeForTaskType(task.type);
      const candidate =
        this.repos.agents
          .findByProject(task.projectId)
          .find((a) => a.archetype === wanted && a.currentTaskId === null) ??
        this.repos.agents.findByProject(task.projectId).find((a) => a.currentTaskId === null);

      if (!candidate) {
        throw refuse(
          `Nobody on this project is free to take this on. Assign someone, or hire a ${ARCHETYPES[wanted].title}.`,
        );
      }
      this.assignInternal(taskId, candidate.id, changes);
      agentId = candidate.id;
    }

    const agent = this.repos.agents.findById(agentId);
    if (!agent) throw notFound('Agent');

    const resuming = task.status === 'paused';
    const now = Date.now();

    changes.task(
      this.repos.tasks.update(taskId, {
        status: 'working',
        // Start is the simulation. Running this task for real is its own
        // command, and it is what sets the row back to live.
        runMode: 'simulated',
        blocker: null,
        ...(task.startedAt === null ? { startedAt: now } : {}),
      }),
    );
    changes.agent(this.repos.agents.update(agent.id, { status: 'working', updatedAt: now }));

    this.log(
      changes,
      resuming ? 'resumed' : 'started',
      resuming
        ? `${agent.name} resumed “${task.title}” at ${Math.round(task.progress)}%`
        : `${agent.name} started “${task.title}”`,
      { task, agent, at: now },
    );
  }

  /** Put an agent back to idle with nothing in hand. */
  private releaseAgent(agentId: Id, changes: ChangeSet): Agent | null {
    const released = this.repos.agents.update(agentId, {
      currentTaskId: null,
      status: 'idle',
      progress: 0,
      updatedAt: Date.now(),
    });
    changes.agent(released);
    return released;
  }

  private log(
    changes: ChangeSet,
    eventType: ActivityEventType,
    message: string,
    ctx: { task?: Task | null; agent?: Agent | null; projectId?: Id; at: number },
  ): void {
    const event: ActivityEvent = {
      id: newId('evt'),
      projectId: ctx.task?.projectId ?? ctx.agent?.projectId ?? ctx.projectId ?? null,
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

/** Which archetype naturally owns a kind of work. Used to suggest, never force. */
export const preferredArchetypeFor = (type: TaskType): AgentArchetype => archetypeForTaskType(type);

export { APPROVAL_PLOT };
