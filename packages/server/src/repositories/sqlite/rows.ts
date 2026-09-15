import {
  APPROVAL_CATEGORY_KEYS,
  MILESTONE_STATUSES,
  PROJECT_FILE_KINDS,
  RISK_LEVELS,
} from '@ai-islands/shared';
import type {
  ActivityEvent,
  ActivityEventType,
  Agent,
  AgentArchetype,
  ApprovalRequest,
  BiomeKey,
  PlotKey,
  Milestone,
  Project,
  ProjectFile,
  Task,
  TaskPriority,
} from '@ai-islands/shared';

/**
 * Row shapes and the mapping to domain objects.
 *
 * SQLite has no booleans, no arrays and no nested objects, so the translation
 * lives here rather than being repeated in every repository method.
 */

export interface ProjectRow {
  id: string;
  name: string;
  description: string;
  goals: string;
  repository: string;
  status: string;
  template: string;
  color: string;
  biome: string;
  seed: number;
  layout_col: number;
  layout_row: number;
  crates: number;
  created_at: number;
  updated_at: number;
}

export const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  description: r.description,
  goals: r.goals,
  repository: r.repository,
  status: r.status as Project['status'],
  // An unrecognised template reads as standard: a row written by a newer build
  // must not make an older one refuse to render the world.
  template: r.template === 'deal_room' ? 'deal_room' : 'standard',
  color: r.color,
  appearance: {
    biome: r.biome as BiomeKey,
    seed: r.seed,
    layout: { col: r.layout_col, row: r.layout_row },
  },
  crates: r.crates,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface AgentRow {
  id: string;
  project_id: string;
  archetype: string;
  name: string;
  role: string;
  instructions: string;
  tools: string;
  model: string;
  max_execution_ms: number;
  max_output_tokens: number;
  requires_approval: number;
  status: string;
  current_task_id: string | null;
  current_location: string;
  move_from: string | null;
  move_to: string | null;
  move_departed: number | null;
  move_arrives: number | null;
  progress: number;
  created_at: number;
  updated_at: number;
}

/** Tools are stored as a JSON array; a corrupt value must not break a read. */
function parseTools(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export const toAgent = (r: AgentRow): Agent => ({
  id: r.id,
  projectId: r.project_id,
  archetype: r.archetype as AgentArchetype,
  name: r.name,
  role: r.role,
  instructions: r.instructions,
  tools: parseTools(r.tools),
  model: r.model,
  maxExecutionMs: r.max_execution_ms,
  maxOutputTokens: r.max_output_tokens,
  requiresApproval: r.requires_approval === 1,
  status: r.status as Agent['status'],
  currentTaskId: r.current_task_id,
  currentLocation: r.current_location as PlotKey,
  // All four movement columns are written together, so testing one is enough.
  movement:
    r.move_to && r.move_from && r.move_departed !== null && r.move_arrives !== null
      ? {
          fromKey: r.move_from as PlotKey,
          toKey: r.move_to as PlotKey,
          departedAt: r.move_departed,
          arrivesAt: r.move_arrives,
        }
      : null,
  progress: r.progress,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface MilestoneRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  due_at: number | null;
  status: string;
  created_at: number;
  updated_at: number;
}

export const toMilestone = (r: MilestoneRow): Milestone => ({
  id: r.id,
  projectId: r.project_id,
  title: r.title,
  description: r.description,
  dueAt: r.due_at,
  status: (MILESTONE_STATUSES as readonly string[]).includes(r.status)
    ? (r.status as Milestone['status'])
    : 'open',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface ProjectFileRow {
  id: string;
  project_id: string;
  task_id: string | null;
  agent_id: string | null;
  name: string;
  kind: string;
  location: string;
  note: string;
  created_at: number;
}

export const toProjectFile = (r: ProjectFileRow): ProjectFile => ({
  id: r.id,
  projectId: r.project_id,
  taskId: r.task_id,
  agentId: r.agent_id,
  name: r.name,
  kind: (PROJECT_FILE_KINDS as readonly string[]).includes(r.kind)
    ? (r.kind as ProjectFile['kind'])
    : 'other',
  location: r.location,
  note: r.note,
  createdAt: r.created_at,
});

export interface TaskRow {
  id: string;
  project_id: string;
  assigned_agent_id: string | null;
  title: string;
  description: string;
  type: string;
  status: string;
  priority: string;
  building_key: string;
  progress: number;
  duration_seconds: number;
  needs_approval: number;
  blocker: string | null;
  created_at: number;
  run_mode: string;
  parent_task_id: string | null;
  milestone_id: string | null;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}

/**
 * A task, plus the dependency ids the repository looked up.
 *
 * Passed in rather than joined here because `toTask` is called for every row of
 * every listing: doing a second query per row would turn one board render into
 * a hundred statements.
 */
export const toTask = (r: TaskRow, dependsOn: string[] = []): Task => ({
  id: r.id,
  projectId: r.project_id,
  assignedAgentId: r.assigned_agent_id,
  title: r.title,
  description: r.description,
  type: r.type as Task['type'],
  status: r.status as Task['status'],
  priority: r.priority as TaskPriority,
  buildingKey: r.building_key as PlotKey,
  progress: r.progress,
  runMode: r.run_mode === 'live' ? 'live' : 'simulated',
  parentTaskId: r.parent_task_id,
  milestoneId: r.milestone_id,
  dependsOn,
  durationSeconds: r.duration_seconds,
  needsApproval: r.needs_approval === 1,
  blocker: r.blocker,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  startedAt: r.started_at,
  completedAt: r.completed_at,
});

export interface ApprovalRow {
  id: string;
  task_id: string;
  agent_id: string;
  summary: string;
  category: string;
  action: string;
  reason: string;
  /** JSON array. */
  tools: string;
  impact: string;
  /** JSON array. */
  files: string;
  risk: string;
  blocking: number;
  status: string;
  requested_at: number;
  decided_at: number | null;
  note: string | null;
}

/** A stored list that will not parse must not break reading the queue. */
function parseList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export const toApproval = (r: ApprovalRow): ApprovalRequest => ({
  id: r.id,
  taskId: r.task_id,
  agentId: r.agent_id,
  summary: r.summary,
  // An unrecognised category reads as the configured catch-all rather than
  // throwing: a queue that will not render is worse than a vague label.
  category: (APPROVAL_CATEGORY_KEYS as readonly string[]).includes(r.category)
    ? (r.category as ApprovalRequest['category'])
    : 'configured',
  action: r.action,
  reason: r.reason,
  tools: parseList(r.tools),
  impact: r.impact,
  files: parseList(r.files),
  risk: (RISK_LEVELS as readonly string[]).includes(r.risk)
    ? (r.risk as ApprovalRequest['risk'])
    : 'medium',
  blocking: r.blocking === 1,
  status: r.status as ApprovalRequest['status'],
  requestedAt: r.requested_at,
  decidedAt: r.decided_at,
  note: r.note,
});

export interface ActivityRow {
  id: string;
  project_id: string | null;
  agent_id: string | null;
  task_id: string | null;
  event_type: string;
  message: string;
  timestamp: number;
}

export const toActivity = (r: ActivityRow): ActivityEvent => ({
  id: r.id,
  projectId: r.project_id,
  agentId: r.agent_id,
  taskId: r.task_id,
  eventType: r.event_type as ActivityEventType,
  message: r.message,
  timestamp: r.timestamp,
});
