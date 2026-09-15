import {
  ARCHETYPES,
  PLOTS,
  TASK_TYPES,
  isTerminalTaskStatus,
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
  /**
   * Where to draw it, in island grid coordinates.
   *
   * Nudged by `spreadOverlaps` when several agents share a spot, so a group
   * standing together reads as a group rather than as one agent.
   */
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

/**
 * Nudge agents apart when they are standing on the same spot.
 *
 * Several idle agents gather at the same place, and drawn at the same
 * coordinates they become one sprite with the rest hidden underneath — a team
 * of five would look like a team of one. They are spread around a small ring
 * instead, deterministically by id so nobody jitters between frames.
 *
 * This is presentation only: the agent is still *at* that place, and its row
 * is untouched.
 */
function spreadOverlaps(displays: AgentDisplay[]): AgentDisplay[] {
  const groups = new Map<string, AgentDisplay[]>();
  for (const d of displays) {
    // An agent mid-walk is already somewhere of its own.
    if (d.agent.movement) continue;
    const key = `${d.position.c.toFixed(2)}:${d.position.r.toFixed(2)}`;
    const group = groups.get(key);
    if (group) group.push(d);
    else groups.set(key, [d]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => a.agent.id.localeCompare(b.agent.id));
    const half = (ordered.length - 1) / 2;

    ordered.forEach((d, i) => {
      // Isometric screen-x follows (c - r) and depth follows (c + r), so moving
      // +lateral on one axis and -lateral on the other slides an agent sideways
      // without changing how far away it looks. That is what keeps a row of
      // nameplates side by side instead of stacked on top of each other.
      const lateral = (i - half) * 0.85;
      // A small alternating depth offset so neighbouring plates are not exactly
      // level, which reads as a group standing about rather than a rank.
      const depth = (i % 2 === 0 ? -1 : 1) * 0.2;
      d.position = {
        c: d.position.c + lateral + depth,
        r: d.position.r - lateral + depth,
      };
    });
  }

  return displays;
}

export function agentsForProject(
  world: WorldSnapshot,
  projectId: string,
  now: number,
): AgentDisplay[] {
  return spreadOverlaps(
    world.agents
      .filter((a) => a.projectId === projectId)
      .map((a) => toAgentDisplay(world, a, now))
      .filter((d): d is AgentDisplay => d !== null),
  );
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
  /**
   * How the project is actually doing, and why.
   *
   * The word alone is not enough to act on: "Blocked" leaves you to go and
   * find out what is blocked. The reason travels with it, so the card answers
   * the follow-up question before it is asked.
   */
  health: { label: string; tone: string; reason: string };
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

    const plural = (n: number, one: string, many = `${one}s`) =>
      `${n} ${n === 1 ? one : many}`;

    const overdue = world.milestones.filter(
      (m) =>
        m.projectId === project.id &&
        m.status === 'open' &&
        m.dueAt !== null &&
        m.dueAt < Date.now(),
    ).length;

    const openCount = tasks.filter((t) => !isTerminalTaskStatus(t.status)).length;

    // Same order of urgency, but each answer says what to do about it. An
    // overdue milestone outranks ordinary progress: it is the one thing here
    // that gets worse on its own while nobody looks.
    const health = blockedCount
      ? {
          label: 'Blocked',
          tone: 'bad',
          reason: `${plural(blockedCount, 'task')} stopped and waiting on a decision from you.`,
        }
      : awaitingCount
        ? {
            label: 'Needs you',
            tone: 'warn',
            reason: `${plural(awaitingCount, 'piece', 'pieces')} of finished work waiting for your sign-off.`,
          }
        : overdue
          ? {
              label: 'Behind',
              tone: 'warn',
              reason: `${plural(overdue, 'milestone')} past its due date.`,
            }
          : activeCount
            ? {
                label: 'Moving',
                tone: 'ok',
                reason: `${plural(activeCount, 'task')} under way right now.`,
              }
            : openCount
              ? {
                  label: 'Idle',
                  tone: 'info',
                  reason: `${plural(openCount, 'task')} open, nobody working on any of them.`,
                }
              : tasks.length
                ? {
                    label: 'All done',
                    tone: 'violet',
                    reason: `Everything on this island has been delivered.`,
                  }
                : {
                    label: 'Empty',
                    tone: 'mute',
                    reason: 'No tasks yet. Add one to get the island moving.',
                  };

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
      health,
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
