import type { AgentStatus } from './status.js';
import type {
  ActivityEvent,
  Agent,
  ApprovalRequest,
  ApprovalStatus,
  EngineInfo,
  Id,
  Project,
  RunMode,
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

/**
 * What happened, as opposed to what is now true.
 *
 * The row-carrying events above are the state of record: they are what every
 * screen renders. These say which transition produced that state, which is what
 * you need to react rather than re-render — to fetch a result the moment its
 * task finishes, to raise a toast when a run fails, to draw attention to an
 * approval the moment it is asked for.
 *
 * They are derived from the rows that changed, in one place on the server, so a
 * domain event and the row it describes can never disagree — and it does not
 * matter whether the change came from the simulation or from a real agent.
 */
export type DomainEvent =
  /** An agent moved between states. `from` is null the first time it is seen. */
  | { kind: 'agent.status'; agentId: Id; from: AgentStatus | null; to: AgentStatus; taskId: Id | null }
  | { kind: 'task.created'; taskId: Id; projectId: Id; title: string }
  /** Work actually began. `runMode` says whether a model is doing it. */
  | { kind: 'task.started'; taskId: Id; agentId: Id | null; runMode: RunMode }
  | { kind: 'task.progress'; taskId: Id; progress: number; runMode: RunMode }
  | { kind: 'task.completed'; taskId: Id; agentId: Id | null; runMode: RunMode }
  | { kind: 'task.failed'; taskId: Id; agentId: Id | null; reason: string | null }
  | { kind: 'approval.requested'; approvalId: Id; taskId: Id; agentId: Id; summary: string }
  | { kind: 'approval.resolved'; approvalId: Id; taskId: Id; decision: ApprovalStatus };

export type DomainEventKind = DomainEvent['kind'];

/** Every kind, as data — so a UI can subscribe to one without a string literal. */
export const DOMAIN_EVENT_KINDS = [
  'agent.status',
  'task.created',
  'task.started',
  'task.progress',
  'task.completed',
  'task.failed',
  'approval.requested',
  'approval.resolved',
] as const satisfies readonly DomainEventKind[];

type EveryKindIsListed =
  Exclude<DomainEventKind, (typeof DOMAIN_EVENT_KINDS)[number]> extends never ? true : never;
const _kindsExhaustive: EveryKindIsListed = true;
void _kindsExhaustive;

/** Domain events from one change, in the order they happened. */
export interface DomainEventsMessage {
  type: 'events';
  at: Timestamp;
  events: DomainEvent[];
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
  | DomainEventsMessage
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
  'events',
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
