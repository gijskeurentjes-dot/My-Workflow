import {
  BOT_PROFILES,
  PLOTS,
  TASK_TYPES,
  describeBot,
  movementState,
  positionAlongPath,
  type Bot,
  type BotProfile,
  type Island,
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

export interface BotDisplay {
  bot: Bot;
  profile: BotProfile;
  island: Island;
  task: Task | null;
  project: Project | null;
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
 * Place a bot on its island.
 *
 * The server only says "walking from A to B, arriving at time T". The walk
 * itself is interpolated here, every frame, so a 2 Hz stream still renders as
 * smooth movement.
 */
export function botPosition(bot: Bot, now: number): { c: number; r: number } {
  if (!bot.movement) return { ...PLOTS[bot.locationKey].cell };

  const { fromKey, toKey, departedAt, arrivesAt } = bot.movement;
  const span = arrivesAt - departedAt;
  // A zero-length walk would divide by zero; treat it as already arrived.
  const t = span <= 0 ? 1 : (now - departedAt) / span;
  return positionAlongPath(fromKey, toKey, t);
}

function facingOf(bot: Bot, position: { c: number; r: number }): 1 | -1 {
  if (!bot.movement) return 1;
  const target = PLOTS[bot.movement.toKey].cell;
  // In isometric space, screen-x follows (c - r).
  return target.c - target.r >= position.c - position.r ? 1 : -1;
}

export function toBotDisplay(world: WorldSnapshot, bot: Bot, now: number): BotDisplay | null {
  const island = world.islands.find((i) => i.id === bot.islandId);
  if (!island) return null;

  const task = bot.taskId ? (world.tasks.find((t) => t.id === bot.taskId) ?? null) : null;
  const project = task ? (world.projects.find((p) => p.id === task.projectId) ?? null) : null;
  const position = botPosition(bot, now);

  return {
    bot,
    profile: BOT_PROFILES[bot.key],
    island,
    task,
    project,
    movement: movementState(bot),
    // Rotating on a slow clock keeps a working agent from looking frozen.
    doing: describeBot(bot, task, Math.floor(now / 6000)),
    position,
    facing: facingOf(bot, position),
    carrying:
      bot.status === 'waiting_approval' ||
      task?.status === 'delivering' ||
      task?.status === 'waiting_approval',
  };
}

export function botsForIsland(world: WorldSnapshot, islandId: string, now: number): BotDisplay[] {
  return world.bots
    .filter((b) => b.islandId === islandId)
    .map((b) => toBotDisplay(world, b, now))
    .filter((d): d is BotDisplay => d !== null);
}

export function allBotDisplays(world: WorldSnapshot, now: number): BotDisplay[] {
  return world.bots
    .map((b) => toBotDisplay(world, b, now))
    .filter((d): d is BotDisplay => d !== null)
    .sort((a, b) => a.profile.name.localeCompare(b.profile.name));
}

// ─────────────────────────────────────────────────────────────────────────────

export interface IslandSummary {
  island: Island;
  bots: Bot[];
  tasks: Task[];
  activeCount: number;
  backlogCount: number;
  doneCount: number;
  blockedCount: number;
  awaitingCount: number;
  /** A one-word state for the island card. */
  state: { label: string; tone: string };
}

export function islandSummaries(world: WorldSnapshot): IslandSummary[] {
  return world.islands.map((island) => {
    const bots = world.bots.filter((b) => b.islandId === island.id);
    const tasks = world.tasks.filter((t) => t.islandId === island.id);

    const blockedCount = tasks.filter((t) => t.status === 'failed').length;
    const awaitingCount = tasks.filter((t) => t.status === 'waiting_approval').length;
    const activeCount = tasks.filter(
      (t) => t.status === 'working' || t.status === 'delivering',
    ).length;

    // Ordered by urgency: a blocked island matters more than a busy one.
    const state = blockedCount
      ? { label: 'Blocked', tone: 'bad' }
      : awaitingCount
        ? { label: 'Needs you', tone: 'warn' }
        : activeCount
          ? { label: 'Working', tone: 'ok' }
          : { label: 'Quiet', tone: 'mute' };

    return {
      island,
      bots,
      tasks,
      activeCount,
      backlogCount: tasks.filter((t) => t.status === 'backlog').length,
      doneCount: tasks.filter((t) => t.status === 'completed').length,
      blockedCount,
      awaitingCount,
      state,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectSummary {
  project: Project;
  tasks: Task[];
  done: number;
  open: number;
  blocked: number;
  awaiting: number;
  percent: number;
}

export function projectSummaries(world: WorldSnapshot): ProjectSummary[] {
  return world.projects.map((project) => {
    const tasks = world.tasks.filter((t) => t.projectId === project.id);
    const done = tasks.filter((t) => t.status === 'completed').length;
    return {
      project,
      tasks,
      done,
      open: tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length,
      blocked: tasks.filter((t) => t.status === 'failed').length,
      awaiting: tasks.filter((t) => t.status === 'waiting_approval').length,
      percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    };
  });
}

/** Everything a task row needs, joined up. */
export interface TaskDisplay {
  task: Task;
  project: Project | null;
  island: Island | null;
  bot: Bot | null;
  typeInfo: (typeof TASK_TYPES)[keyof typeof TASK_TYPES];
}

export function toTaskDisplay(world: WorldSnapshot, task: Task): TaskDisplay {
  return {
    task,
    project: world.projects.find((p) => p.id === task.projectId) ?? null,
    island: world.islands.find((i) => i.id === task.islandId) ?? null,
    bot: task.botId ? (world.bots.find((b) => b.id === task.botId) ?? null) : null,
    typeInfo: TASK_TYPES[task.type],
  };
}

export const findIsland = (world: WorldSnapshot, id: string): Island | null =>
  world.islands.find((i) => i.id === id) ?? null;

export const findBot = (world: WorldSnapshot, id: string): Bot | null =>
  world.bots.find((b) => b.id === id) ?? null;

export const findProject = (world: WorldSnapshot, id: string): Project | null =>
  world.projects.find((p) => p.id === id) ?? null;
