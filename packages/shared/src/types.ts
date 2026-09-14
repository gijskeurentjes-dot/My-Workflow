import type { AgentStatus, MovementState, TaskStatus } from './status.js';

/** Identifiers are opaque strings everywhere; the database picks the format. */
export type Id = string;

/** Milliseconds since the Unix epoch. Every timestamp on the wire is a number. */
export type Timestamp = number;

// ─────────────────────────────────────────────────────────────────────────────
// Projects — one project is one island
// ─────────────────────────────────────────────────────────────────────────────

export type ProjectStatus = 'active' | 'paused' | 'archived';

export type BiomeKey = 'civic' | 'scholar' | 'forge' | 'studio' | 'ledger';

/**
 * How a project's island looks.
 *
 * Fixed when the project is created, so an island someone has learned to
 * recognise never changes shape underneath them.
 */
export interface IslandAppearance {
  biome: BiomeKey;
  /** Seeds the terrain generator. The same seed always draws the same island. */
  seed: number;
  /** Where the island sits on the world map, in grid columns and rows. */
  layout: { col: number; row: number };
}

export interface Project {
  id: Id;
  name: string;
  description: string;
  status: ProjectStatus;
  /** Accent colour used on cards and task chips. */
  color: string;
  appearance: IslandAppearance;
  /** Delivered work, crated at the depot. One crate per completed task. */
  crates: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agents — every project has its own team
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The kind of worker an agent is.
 *
 * An archetype decides how the agent looks, which work it naturally handles,
 * and the brief it starts with. Its name, role, instructions and tools are all
 * editable afterwards, so two projects can have very different Developers.
 */
export type AgentArchetype = 'pm' | 'researcher' | 'developer' | 'presenter' | 'analyst';

/** The static half of an archetype: appearance and sensible starting points. */
export interface ArchetypeProfile {
  key: AgentArchetype;
  /** Default role title, and the default name suggested when hiring. */
  title: string;
  defaultName: string;
  icon: string;
  color: { base: string; dark: string; light: string };
  tagline: string;
  responsibilities: string[];
  tools: string[];
  /** The rules this kind of agent is held to. */
  approvalRules: string[];
  /** Rotating status lines shown while it is working. */
  thoughts: string[];
  /** Which kinds of task this archetype is the natural owner of. */
  handles: TaskType[];
  /** Where on the island it waits and works by default. */
  home: PlotKey;
}

export interface AgentMovement {
  fromKey: PlotKey;
  toKey: PlotKey;
  departedAt: Timestamp;
  arrivesAt: Timestamp;
}

export interface Agent {
  id: Id;
  projectId: Id;
  archetype: AgentArchetype;
  name: string;
  /** What this agent is for. */
  role: string;
  /** The brief a real engine sends as this agent's system prompt. */
  instructions: string;
  /**
   * What this agent is allowed to reach for.
   *
   * This is an allow-list, enforced on the server before a run starts: a tool
   * not named here is never offered to the model, whatever the instructions say.
   */
  tools: string[];
  /** Which Claude model runs this agent. */
  model: string;
  /** Hard wall-clock ceiling for one run, in milliseconds. */
  maxExecutionMs: number;
  /**
   * Ceiling on tokens this agent may generate in one run.
   *
   * The usage limit the brief asks for: a run that would exceed it is stopped
   * rather than allowed to keep spending.
   */
  maxOutputTokens: number;
  /** Whether this agent's finished work always needs your sign-off. */
  requiresApproval: boolean;
  status: AgentStatus;
  currentTaskId: Id | null;
  /** Which building on its project's island it is at, or heading to. */
  currentLocation: PlotKey;
  /**
   * Set while between buildings. The client interpolates along the road network
   * using these timestamps, so no per-frame traffic is needed.
   */
  movement: AgentMovement | null;
  /** Progress of the held task, 0–100. Mirrored here for cheap rendering. */
  progress: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** An agent joined to everything the UI needs to describe it in one line. */
export interface AgentView extends Agent {
  profile: ArchetypeProfile;
  project: Project;
  task: Task | null;
  movementState: MovementState;
  /** Human-readable sentence: "Walking to the Workshop", "Running tests…". */
  doing: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────────────────────────────────────

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

/** Task type decides which building on the island the work happens at. */
export type TaskType = 'planning' | 'research' | 'coding' | 'writing' | 'analysis' | 'review';

export interface TaskTypeInfo {
  key: TaskType;
  label: string;
  icon: string;
  /** The building this kind of work is carried out at. */
  building: PlotKey;
  /** Verb used in activity lines: "researching the market". */
  verb: string;
  /** The archetype that naturally owns this kind of work. */
  owner: AgentArchetype;
}

export interface Task {
  id: Id;
  projectId: Id;
  assignedAgentId: Id | null;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  /** Which building on the project's island this work happens at. */
  buildingKey: PlotKey;
  /** 0–100. Advanced by the agent engine, never by the client. */
  progress: number;
  /**
   * Whether this work is being done by a real agent or the simulation.
   *
   * Recorded on the row rather than inferred, so the interface can say which
   * it is showing you — and keep saying it after a reload, once the run that
   * produced the progress is long over.
   */
  runMode: RunMode;
  /** Simulated seconds of work from 0 to 100%. Ignored by a live run. */
  durationSeconds: number;
  /** Whether finishing the work raises an approval request. */
  needsApproval: boolean;
  /** Set when the task fails: why it stopped and what you need to decide. */
  blocker: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  startedAt: Timestamp | null;
  completedAt: Timestamp | null;
}

/** A task joined to the names the UI would otherwise have to look up. */
export interface TaskView extends Task {
  project: Pick<Project, 'id' | 'name' | 'color'>;
  agent: Pick<Agent, 'id' | 'archetype' | 'name'> | null;
  typeInfo: TaskTypeInfo;
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity log and approvals
// ─────────────────────────────────────────────────────────────────────────────

export type ActivityEventType =
  | 'created'
  | 'assigned'
  | 'queued'
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
  | 'hired'
  | 'dismissed'
  | 'system';

export interface ActivityEvent {
  id: Id;
  projectId: Id | null;
  agentId: Id | null;
  taskId: Id | null;
  eventType: ActivityEventType;
  /** Plain sentence describing what happened, already formatted for display. */
  message: string;
  timestamp: Timestamp;
}

/**
 * What an agent produced.
 *
 * Stored separately from the task so a rerun keeps the previous attempt, and so
 * the structured report can grow without widening the tasks table.
 */
export interface TaskResult {
  id: Id;
  taskId: Id;
  agentId: Id;
  /** One-paragraph answer to the task, suitable for the activity feed. */
  summary: string;
  /** The full structured report the agent returned. */
  report: ResearchReport | null;
  /** Raw assistant text, kept when the structured parse failed. */
  rawText: string;
  model: string;
  /** Why the model stopped: end_turn, max_tokens, refusal, … */
  stopReason: string | null;
  usage: RunUsage;
  /** Wall-clock duration of the run. */
  durationMs: number;
  createdAt: Timestamp;
}

/** Token and cost accounting for one run. */
export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** How many web searches the run actually performed. */
  webSearches: number;
}

/** A source the agent actually retrieved, not one it recalled. */
export interface ResearchSource {
  title: string;
  url: string;
  /** What this source contributed. */
  relevance: string;
}

export interface ResearchFinding {
  /** The claim itself. */
  statement: string;
  /**
   * Whether this is supported by a retrieved source or is the agent's own
   * reading. Keeping them apart is the whole point of the brief.
   */
  kind: 'fact' | 'assumption';
  /** URLs of the sources supporting it. Empty for an assumption. */
  sourceUrls: string[];
}

/** The structured result a research run produces. */
export interface ResearchReport {
  summary: string;
  findings: ResearchFinding[];
  sources: ResearchSource[];
  /** What the agent could not establish. Never left empty by pretending. */
  openQuestions: string[];
  /** The agent's own confidence in the report as a whole. */
  confidence: 'low' | 'medium' | 'high';
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalRequest {
  id: Id;
  taskId: Id;
  agentId: Id;
  /** What the agent is asking you to sign off on. */
  summary: string;
  status: ApprovalStatus;
  requestedAt: Timestamp;
  decidedAt: Timestamp | null;
  /** Reviewer's note, set when sending work back. */
  note: string | null;
}

export interface ApprovalView extends ApprovalRequest {
  task: Pick<Task, 'id' | 'title' | 'type' | 'projectId'>;
  agent: Pick<Agent, 'id' | 'archetype' | 'name'>;
  project: Pick<Project, 'id' | 'name' | 'color'>;
}

// ─────────────────────────────────────────────────────────────────────────────
// World snapshot — one payload the whole UI can render from
// ─────────────────────────────────────────────────────────────────────────────

export interface WorldSnapshot {
  projects: Project[];
  agents: Agent[];
  tasks: Task[];
  approvals: ApprovalRequest[];
  /** Most recent first, capped by the server. */
  activity: ActivityEvent[];
  stats: WorldStats;
  /** Server clock, so the client can correct for drift when interpolating. */
  serverTime: Timestamp;
  /** Which agent engine produced this snapshot. */
  engine: EngineInfo;
  /**
   * What can be run for real. Carried on the snapshot so every screen can tell
   * a live agent from a simulated one without a second request.
   */
  runtime: RuntimeInfo;
}

export interface WorldStats {
  projects: number;
  agents: number;
  agentsWorking: number;
  agentsIdle: number;
  tasksOpen: number;
  tasksCompleted: number;
  approvalsPending: number;
}

/**
 * How a task's progress is being produced.
 *
 * `simulated` is the mock state machine — no model is called. `live` means a
 * real agent ran, and every number on the row came from that run.
 */
export const RUN_MODES = ['simulated', 'live'] as const;
export type RunMode = (typeof RUN_MODES)[number];

/** What the server can actually execute for real, reported to the interface. */
export interface RuntimeInfo {
  /** True when a real agent could be run right now. */
  available: boolean;
  /** Whether an API key is configured at all. Never the key itself. */
  credentialsConfigured: boolean;
  /** The default model a live run uses. */
  model: string;
  /** Archetypes with a live engine behind them. */
  archetypes: string[];
  maxSearches: number;
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

/**
 * The places every project island has. Agents walk between them, and a task's
 * kind of work decides which one it is carried out at.
 */
export type PlotKey =
  | 'hq'
  | 'library'
  | 'workshop'
  | 'studio'
  | 'data'
  | 'rest'
  | 'gate'
  | 'depot';

export interface PlotInfo {
  key: PlotKey;
  label: string;
  icon: string;
  /** What this place is for, shown when you select it. */
  purpose: string;
  /** Position on the island's tile grid. */
  cell: { c: number; r: number };
}
