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
  'review',
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
  'todo',
  'queued',
  'working',
  'waiting_approval',
  'review',
  'delivering',
  'completed',
  'paused',
  'failed',
  'cancelled',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_LABEL: Record<AgentStatus | TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  idle: 'Idle',
  queued: 'Queued',
  working: 'Working',
  waiting_approval: 'Waiting for approval',
  review: 'In review',
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
  todo: 'info',
  idle: 'mute',
  queued: 'info',
  working: 'ok',
  waiting_approval: 'warn',
  review: 'info',
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
  'review',
  'delivering',
  'paused',
  'failed',
];

export const isTerminalTaskStatus = (s: TaskStatus): boolean =>
  TERMINAL_TASK_STATUSES.includes(s);

export const isActiveTaskStatus = (s: TaskStatus): boolean =>
  ACTIVE_TASK_STATUSES.includes(s);

/**
 * The board, as columns.
 *
 * Seven lanes, each one a question about the work: is it scheduled, is anyone
 * doing it, is it waiting on you. Several statuses can share a lane — queued,
 * working and delivering all read as "in progress" to a person looking at a
 * board — so the mapping lives here rather than in the screen that draws it,
 * and the server and the interface group work the same way.
 */
export const BOARD_COLUMNS = [
  { key: 'backlog', label: 'Backlog', description: 'Captured, not scheduled.', statuses: ['backlog'] },
  { key: 'todo', label: 'To do', description: 'Ready to start.', statuses: ['todo'] },
  {
    key: 'in_progress',
    label: 'In progress',
    description: 'An agent is on it.',
    statuses: ['queued', 'working', 'delivering', 'paused'],
  },
  {
    key: 'waiting_approval',
    label: 'Waiting for approval',
    description: 'Stopped until you decide.',
    statuses: ['waiting_approval'],
  },
  { key: 'review', label: 'Review', description: 'Finished, being checked.', statuses: ['review'] },
  { key: 'completed', label: 'Completed', description: 'Delivered.', statuses: ['completed'] },
  {
    key: 'failed',
    label: 'Failed',
    description: 'Blocked, or called off.',
    statuses: ['failed', 'cancelled'],
  },
] as const satisfies readonly {
  key: string;
  label: string;
  description: string;
  statuses: readonly TaskStatus[];
}[];

export type BoardColumnKey = (typeof BOARD_COLUMNS)[number]['key'];

/** Which lane a task belongs in. Every status has exactly one. */
export function boardColumnFor(status: TaskStatus): BoardColumnKey {
  const column = BOARD_COLUMNS.find((c) => (c.statuses as readonly TaskStatus[]).includes(status));
  return column?.key ?? 'backlog';
}

/**
 * Fails to compile if a status has no lane, so adding one to the state machine
 * forces a decision about where it shows up rather than letting it vanish.
 */
type EveryStatusHasAColumn =
  Exclude<TaskStatus, (typeof BOARD_COLUMNS)[number]['statuses'][number]> extends never
    ? true
    : never;
const _columnsExhaustive: EveryStatusHasAColumn = true;
void _columnsExhaustive;

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
