import type { BotStatus, MovementState, TaskStatus } from './status.js';

/** Identifiers are opaque strings everywhere; the database picks the format. */
export type Id = string;

/** Milliseconds since the Unix epoch. Every timestamp on the wire is a number. */
export type Timestamp = number;

// ─────────────────────────────────────────────────────────────────────────────
// Islands — the work areas that make up the visual world
// ─────────────────────────────────────────────────────────────────────────────

/** The kind of work an island is built for. Decides its resident bot. */
export type IslandKey =
  | 'headquarters'
  | 'research-library'
  | 'workshop'
  | 'presentation-studio'
  | 'data-workshop';

export interface Island {
  id: Id;
  /** Stable key used by the renderer to pick terrain, biome and buildings. */
  key: IslandKey;
  name: string;
  /** One line on what happens here, shown on the island card. */
  blurb: string;
  biome: BiomeKey;
  /** Seeds the terrain generator, so an island's shape never changes. */
  seed: number;
  /** Where the island sits on the world map, in grid columns/rows. */
  layout: { col: number; row: number };
  /** Count of delivered work crates stacked at the depot. */
  crates: number;
  createdAt: Timestamp;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bots — the five agents
// ─────────────────────────────────────────────────────────────────────────────

export type BotKey = 'atlas' | 'nova' | 'forge' | 'slidebuilder' | 'excel-expert';

/**
 * The static half of a bot: who it is and what it is allowed to do.
 * This is the part a real agent engine would turn into a system prompt,
 * a tool list and a set of approval rules.
 */
export interface BotProfile {
  key: BotKey;
  name: string;
  title: string;
  /** The island this bot calls home. */
  homeIsland: IslandKey;
  icon: string;
  color: { base: string; dark: string; light: string };
  tagline: string;
  responsibilities: string[];
  tools: string[];
  /** The rules a real agent would be held to. Displayed, not yet enforced. */
  approvalRules: string[];
  /** Rotating status lines shown while the bot is working. */
  thoughts: string[];
  /** Which kinds of task this bot is the natural owner of. */
  handles: TaskType[];
}

/**
 * The live half of a bot: where it is and what it is doing right now.
 * The server owns this; the client animates between successive snapshots.
 */
export interface Bot {
  id: Id;
  key: BotKey;
  name: string;
  islandId: Id;
  /**
   * What this agent is for. Seeded from its profile, then editable — so a real
   * engine reads the agent's brief from the database rather than from code.
   */
  role: string;
  /** The brief a real engine would send as this agent's system prompt. */
  instructions: string;
  /** What this agent is allowed to reach for. */
  tools: string[];
  status: BotStatus;
  /** The task currently held, if any. */
  taskId: Id | null;
  /** Which plot on the island the bot is at, or heading to. */
  locationKey: PlotKey;
  /**
   * Set while the bot is between plots. The client interpolates along the
   * road network using these timestamps, so no per-frame traffic is needed.
   */
  movement: BotMovement | null;
  /** Progress of the held task, 0–100. Mirrored here for cheap rendering. */
  progress: number;
  updatedAt: Timestamp;
}

export interface BotMovement {
  fromKey: PlotKey;
  toKey: PlotKey;
  departedAt: Timestamp;
  arrivesAt: Timestamp;
}

/** A bot joined to everything the UI needs to describe it in one line. */
export interface BotView extends Bot {
  profile: BotProfile;
  island: Island;
  task: Task | null;
  movementState: MovementState;
  /** Human-readable sentence: "Walking to the Workbench", "Rebuilding the pivot…". */
  doing: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Projects and tasks
// ─────────────────────────────────────────────────────────────────────────────

export type ProjectStatus = 'active' | 'paused' | 'archived';

export interface Project {
  id: Id;
  name: string;
  goal: string;
  status: ProjectStatus;
  /** Accent colour used on project cards and task chips. */
  color: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * How urgent a task is.
 *
 * Priority is not decoration: it orders the board, and it decides which waiting
 * task an idle agent picks up first.
 */
export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

/** Higher sorts first. */
export const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 3,
  high: 2,
  normal: 1,
  low: 0,
};

export const PRIORITY_TONE: Record<TaskPriority, string> = {
  urgent: 'bad',
  high: 'warn',
  normal: 'mute',
  low: 'mute',
};

/** Task type decides which island the work physically happens on. */
export type TaskType = 'planning' | 'research' | 'coding' | 'writing' | 'analysis' | 'review';

export interface TaskTypeInfo {
  key: TaskType;
  label: string;
  icon: string;
  /** Where a task of this type is carried out. */
  island: IslandKey;
  /** Verb used in activity lines: "researching the market". */
  verb: string;
}

export interface Task {
  id: Id;
  projectId: Id;
  title: string;
  notes: string;
  type: TaskType;
  status: TaskStatus;
  /** Orders the board, and decides what gets picked up first. */
  priority: TaskPriority;
  /** Which island the work happens on — derived from `type` at creation. */
  islandId: Id;
  /** The bot holding this task, or null while it sits on the board. */
  botId: Id | null;
  /** 0–100. Advanced by the agent engine, never by the client. */
  progress: number;
  /** Simulated seconds of work from 0 to 100%. */
  durationSeconds: number;
  /** Whether finishing the work raises an approval request. */
  needsApproval: boolean;
  /** Set when the task fails: why it stopped and what you need to decide. */
  blocker: string | null;
  createdAt: Timestamp;
  /** Last time anything about this task changed. */
  updatedAt: Timestamp;
  startedAt: Timestamp | null;
  completedAt: Timestamp | null;
}

/** A task joined to the names the UI would otherwise have to look up. */
export interface TaskView extends Task {
  project: Pick<Project, 'id' | 'name' | 'color'>;
  island: Pick<Island, 'id' | 'key' | 'name'>;
  bot: Pick<Bot, 'id' | 'key' | 'name'> | null;
  typeInfo: TaskTypeInfo;
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity log and approvals
// ─────────────────────────────────────────────────────────────────────────────

export type ActivityKind =
  | 'created'
  | 'assigned'
  | 'started'
  | 'progress'
  | 'paused'
  | 'resumed'
  | 'cancelled'
  | 'approval_requested'
  | 'approved'
  | 'rejected'
  | 'delivered'
  | 'blocked'
  | 'retried'
  | 'arrived'
  | 'departed'
  | 'system';

export interface ActivityEvent {
  id: Id;
  kind: ActivityKind;
  /** Plain sentence describing what happened, already formatted for display. */
  message: string;
  projectId: Id | null;
  taskId: Id | null;
  botId: Id | null;
  islandId: Id | null;
  at: Timestamp;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalRequest {
  id: Id;
  taskId: Id;
  botId: Id;
  /** What the bot is asking you to sign off on. */
  summary: string;
  status: ApprovalStatus;
  requestedAt: Timestamp;
  decidedAt: Timestamp | null;
  /** Reviewer's note, set when rejecting. */
  note: string | null;
}

export interface ApprovalView extends ApprovalRequest {
  task: Pick<Task, 'id' | 'title' | 'type' | 'projectId'>;
  bot: Pick<Bot, 'id' | 'key' | 'name'>;
  project: Pick<Project, 'id' | 'name' | 'color'>;
}

// ─────────────────────────────────────────────────────────────────────────────
// World snapshot — one payload the whole UI can render from
// ─────────────────────────────────────────────────────────────────────────────

export interface WorldSnapshot {
  islands: Island[];
  bots: Bot[];
  projects: Project[];
  tasks: Task[];
  approvals: ApprovalRequest[];
  /** Most recent first, capped by the server. */
  activity: ActivityEvent[];
  stats: WorldStats;
  /** Server clock, so the client can correct for drift when interpolating. */
  serverTime: Timestamp;
  /** Which agent engine produced this snapshot. */
  engine: EngineInfo;
}

export interface WorldStats {
  islands: number;
  bots: number;
  botsWorking: number;
  botsIdle: number;
  projects: number;
  tasksOpen: number;
  tasksCompleted: number;
  approvalsPending: number;
}

export interface EngineInfo {
  /** 'mock' today. 'claude' once real agents land. */
  kind: string;
  /** True while the engine is advancing the world. */
  running: boolean;
  tickMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry
// ─────────────────────────────────────────────────────────────────────────────

/** The named plots every island has. Bots walk between these. */
export type PlotKey = 'gate' | 'workbench' | 'approval' | 'depot' | 'rest';

export interface PlotInfo {
  key: PlotKey;
  label: string;
  icon: string;
  /** What this place is for, shown when you select it. */
  purpose: string;
  /** Position on the island's tile grid. */
  cell: { c: number; r: number };
}

export type BiomeKey = 'civic' | 'scholar' | 'forge' | 'studio' | 'ledger';
