/**
 * The lifecycle states an agent and its work can be in.
 *
 * These eight states are the contract between the agent engine and the UI.
 * The mock engine and the real Claude runtime drive the same eight, which is
 * why a live run needs no screen of its own.
 */
export const AGENT_STATUSES = [
  'idle',
  'queued',
  'working',
  'waiting_approval',
  'completed',
  'paused',
  'failed',
  'cancelled',
] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * Task status mirrors bot status, plus `backlog` for work nobody has picked up
 * and `delivering` for the short walk between approval and the depot.
 */
export const TASK_STATUSES = [
  'backlog',
  'queued',
  'working',
  'waiting_approval',
  'delivering',
  'completed',
  'paused',
  'failed',
  'cancelled',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_LABEL: Record<AgentStatus | TaskStatus, string> = {
  backlog: 'Backlog',
  idle: 'Idle',
  queued: 'Queued',
  working: 'Working',
  waiting_approval: 'Waiting for approval',
  delivering: 'Delivering',
  completed: 'Completed',
  paused: 'Paused',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/**
 * Which CSS status token a state paints with. Kept here rather than in the web
 * package so server-rendered summaries and the client agree on what "working"
 * looks like.
 */
export const STATUS_TONE: Record<AgentStatus | TaskStatus, string> = {
  backlog: 'mute',
  idle: 'mute',
  queued: 'info',
  working: 'ok',
  waiting_approval: 'warn',
  delivering: 'violet',
  completed: 'violet',
  paused: 'info',
  failed: 'bad',
  cancelled: 'mute',
};

/** A task in one of these states is finished — nothing will advance it further. */
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['completed', 'cancelled'];

/** A task in one of these states is actively occupying its assigned bot. */
export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = [
  'queued',
  'working',
  'waiting_approval',
  'delivering',
  'paused',
  'failed',
];

export const isTerminalTaskStatus = (s: TaskStatus): boolean =>
  TERMINAL_TASK_STATUSES.includes(s);

export const isActiveTaskStatus = (s: TaskStatus): boolean =>
  ACTIVE_TASK_STATUSES.includes(s);

/** Movement is derived from status — it is what the world view animates. */
export const MOVEMENT_STATES = [
  'walking',
  'queued',
  'working',
  'waiting',
  'delivering',
  'blocked',
  'paused',
  'idle',
] as const;

export type MovementState = (typeof MOVEMENT_STATES)[number];

export const MOVEMENT_LABEL: Record<MovementState, string> = {
  walking: 'Walking',
  queued: 'Queued to start',
  working: 'Working on site',
  waiting: 'Waiting for you',
  delivering: 'Carrying deliverable',
  blocked: 'Stopped at site',
  paused: 'Holding position',
  idle: 'At rest',
};
