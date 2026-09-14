import type {
  ActivityEvent,
  Agent,
  ApprovalRequest,
  EngineInfo,
  Project,
  Task,
  Timestamp,
  WorldSnapshot,
  WorldStats,
} from './types.js';

/**
 * The realtime contract.
 *
 * Every message the server pushes down the SSE stream is one of these. The
 * client reduces them into its local copy of the world, so adding a new kind of
 * live update means adding a variant here rather than inventing a side channel.
 */

/** Sent once when a client connects, so it can render without a separate fetch. */
export interface SnapshotEvent {
  type: 'snapshot';
  at: Timestamp;
  world: WorldSnapshot;
}

/** Sent on every engine tick that changed something. */
export interface TickEvent {
  type: 'tick';
  at: Timestamp;
  /** Only the agents whose state actually changed. */
  agents: Agent[];
  /** Only the tasks whose state actually changed. */
  tasks: Task[];
  stats: WorldStats;
}

export interface ProjectsChangedEvent {
  type: 'projects';
  at: Timestamp;
  projects: Project[];
}

export interface ApprovalsChangedEvent {
  type: 'approvals';
  at: Timestamp;
  approvals: ApprovalRequest[];
}

/** New rows for the activity log, most recent first. */
export interface ActivityEventMessage {
  type: 'activity';
  at: Timestamp;
  events: ActivityEvent[];
}

/** Engine started, stopped, or was swapped. */
export interface EngineEvent {
  type: 'engine';
  at: Timestamp;
  engine: EngineInfo;
}

/** Keeps proxies from closing an idle stream. Carries the server clock. */
export interface HeartbeatEvent {
  type: 'heartbeat';
  at: Timestamp;
}

export type ServerEvent =
  | SnapshotEvent
  | TickEvent
  | ProjectsChangedEvent
  | ApprovalsChangedEvent
  | ActivityEventMessage
  | EngineEvent
  | HeartbeatEvent;

export type ServerEventType = ServerEvent['type'];

/**
 * Every event name the server emits, as data.
 *
 * The stream sends *named* SSE events (`event: tick`), and a named event only
 * reaches a listener registered for that name — `onmessage` never sees it. The
 * client subscribes by iterating this list, so adding a variant to
 * `ServerEvent` without adding it here is a compile error rather than an event
 * that silently never arrives.
 */
export const SERVER_EVENT_TYPES = [
  'snapshot',
  'tick',
  'projects',
  'approvals',
  'activity',
  'engine',
  'heartbeat',
] as const satisfies readonly ServerEventType[];

/**
 * Fails to compile if a `ServerEvent` variant is missing from the list above.
 * Never referenced at runtime — it exists purely to make the omission loud.
 */
type EveryEventIsListed =
  Exclude<ServerEventType, (typeof SERVER_EVENT_TYPES)[number]> extends never ? true : never;
const _exhaustive: EveryEventIsListed = true;
void _exhaustive;

/** The SSE endpoint. Kept here so client and server cannot disagree on it. */
export const STREAM_PATH = '/api/stream';

/** Base path every REST route hangs off. */
export const API_BASE = '/api';
