import {
  ARCHETYPES,
  PLOTS,
  TASK_TYPES,
  describeAgent,
  movementState,
  positionAlongPath,
  type Agent,
  type ArchetypeProfile,
  type MovementState,
  type Project,
  type Task,
  type WorldSnapshot,
} from '@ai-islands/shared';

/**
 * Derived views over the world snapshot.
 *
 * The server sends flat rows; screens want joined, sorted, grouped things.
 * Doing that here keeps components about layout rather than about lookups.
 */

export interface AgentDisplay {
  agent: Agent;
  profile: ArchetypeProfile;
  project: Project;
  task: Task | null;
  movement: MovementState;
  doing: string;
  /** Where to draw it, in island grid coordinates. */
  position: { c: number; r: number };
  /** Which way it is facing: 1 right, -1 left. */
  facing: 1 | -1;
  /** True while carrying a finished deliverable. */
  carrying: boolean;
}

/**
 * Place an agent on its project's island.
 *
 * The server only says "walking from A to B, arriving at time T". The walk
 * itself is interpolated here, every frame, so a 2 Hz stream still renders as
 * smooth movement.
 */
export function agentPosition(agent: Agent, now: number): { c: number; r: number } {
  if (!agent.movement) return { ...PLOTS[agent.currentLocation].cell };

  const { fromKey, toKey, departedAt, arrivesAt } = agent.movement;
  const span = arrivesAt - departedAt;
  // A zero-length walk would divide by zero; treat it as already arrived.
  const t = span <= 0 ? 1 : (now - departedAt) / span;
  return positionAlongPath(fromKey, toKey, t);
}

function facingOf(agent: Agent, position: { c: number; r: number }): 1 | -1 {
  if (!agent.movement) return 1;
  const target = PLOTS[agent.movement.toKey].cell;
  // In isometric space, screen-x follows (c - r).
  return target.c - target.r >= position.c - position.r ? 1 : -1;
}

export function toAgentDisplay(
  world: WorldSnapshot,
  agent: Agent,
  now: number,
): AgentDisplay | null {
  const project = world.projects.find((p) => p.id === agent.projectId);
  if (!project) return null;

  const task = agent.currentTaskId
    ? (world.tasks.find((t) => t.id === agent.currentTaskId) ?? null)
    : null;
  const position = agentPosition(agent, now);

  return {
    agent,
    profile: ARCHETYPES[agent.archetype],
    project,
    task,
    movement: movementState(agent),
    // Rotating on a slow clock keeps a working agent from looking frozen.
    doing: describeAgent(agent, task, Math.floor(now / 6000)),
    position,
    facing: facingOf(agent, position),
    carrying:
      agent.status === 'waiting_approval' ||
      task?.status === 'delivering' ||
      task?.status === 'waiting_approval',
  };
}

export function agentsForProject(
  world: WorldSnapshot,
  projectId: string,
  now: number,
): AgentDisplay[] {
  return world.agents
    .filter((a) => a.projectId === projectId)
    .map((a) => toAgentDisplay(world, a, now))
    .filter((d): d is AgentDisplay => d !== null);
}

export function allAgentDisplays(world: WorldSnapshot, now: number): AgentDisplay[] {
  return world.agents
    .map((a) => toAgentDisplay(world, a, now))
    .filter((d): d is AgentDisplay => d !== null)
    .sort((a, b) => a.project.name.localeCompare(b.project.name) || a.agent.name.localeCompare(b.agent.name));
}

// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectSummary {
  project: Project;
  agents: Agent[];
  tasks: Task[];
  activeCount: number;
  backlogCount: number;
  doneCount: number;
  blockedCount: number;
  awaitingCount: number;
  percent: number;
  /** A one-word state for the island card. */
  state: { label: string; tone: string };
}

export function projectSummaries(world: WorldSnapshot): ProjectSummary[] {
  return world.projects.map((project) => {
    const agents = world.agents.filter((a) => a.projectId === project.id);
    const tasks = world.tasks.filter((t) => t.projectId === project.id);

    const blockedCount = tasks.filter((t) => t.status === 'failed').length;
    const awaitingCount = tasks.filter((t) => t.status === 'waiting_approval').length;
    const activeCount = tasks.filter(
      (t) => t.status === 'working' || t.status === 'delivering',
    ).length;
    const doneCount = tasks.filter((t) => t.status === 'completed').length;

    // Ordered by urgency: a blocked project matters more than a busy one.
    const state = blockedCount
      ? { label: 'Blocked', tone: 'bad' }
      : awaitingCount
        ? { label: 'Needs you', tone: 'warn' }
        : activeCount
          ? { label: 'Working', tone: 'ok' }
          : { label: 'Quiet', tone: 'mute' };

    return {
      project,
      agents,
      tasks,
      activeCount,
      backlogCount: tasks.filter((t) => t.status === 'backlog').length,
      doneCount,
      blockedCount,
      awaitingCount,
      percent: tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0,
      state,
    };
  });
}

/** Everything a task row needs, joined up. */
export interface TaskDisplay {
  task: Task;
  project: Project | null;
  agent: Agent | null;
  typeInfo: (typeof TASK_TYPES)[keyof typeof TASK_TYPES];
}

export function toTaskDisplay(world: WorldSnapshot, task: Task): TaskDisplay {
  return {
    task,
    project: world.projects.find((p) => p.id === task.projectId) ?? null,
    agent: task.assignedAgentId
      ? (world.agents.find((a) => a.id === task.assignedAgentId) ?? null)
      : null,
    typeInfo: TASK_TYPES[task.type],
  };
}

export const findProject = (world: WorldSnapshot, id: string): Project | null =>
  world.projects.find((p) => p.id === id) ?? null;

export const findAgent = (world: WorldSnapshot, id: string): Agent | null =>
  world.agents.find((a) => a.id === id) ?? null;
