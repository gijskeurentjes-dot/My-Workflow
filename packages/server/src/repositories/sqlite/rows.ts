import type {
  ActivityEvent,
  ActivityEventType,
  Agent,
  AgentArchetype,
  ApprovalRequest,
  BiomeKey,
  PlotKey,
  Project,
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
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}

export const toTask = (r: TaskRow): Task => ({
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
  status: string;
  requested_at: number;
  decided_at: number | null;
  note: string | null;
}

export const toApproval = (r: ApprovalRow): ApprovalRequest => ({
  id: r.id,
  taskId: r.task_id,
  agentId: r.agent_id,
  summary: r.summary,
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
