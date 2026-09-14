import type {
  ActivityEvent,
  TaskPriority,
  ApprovalRequest,
  Bot,
  BotKey,
  BiomeKey,
  Island,
  IslandKey,
  PlotKey,
  Project,
  Task,
} from '@ai-islands/shared';

/**
 * Row shapes and the mapping to domain objects.
 *
 * SQLite has no booleans and no nested objects, so the translation lives here
 * rather than being repeated in every repository method.
 */

export interface IslandRow {
  id: string;
  key: string;
  name: string;
  blurb: string;
  biome: string;
  seed: number;
  layout_col: number;
  layout_row: number;
  crates: number;
  created_at: number;
}

export const toIsland = (r: IslandRow): Island => ({
  id: r.id,
  key: r.key as IslandKey,
  name: r.name,
  blurb: r.blurb,
  biome: r.biome as BiomeKey,
  seed: r.seed,
  layout: { col: r.layout_col, row: r.layout_row },
  crates: r.crates,
  createdAt: r.created_at,
});

export interface BotRow {
  id: string;
  key: string;
  name: string;
  island_id: string;
  role: string;
  instructions: string;
  tools: string;
  status: string;
  task_id: string | null;
  location_key: string;
  move_from: string | null;
  move_to: string | null;
  move_departed: number | null;
  move_arrives: number | null;
  progress: number;
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

export const toBot = (r: BotRow): Bot => ({
  id: r.id,
  key: r.key as BotKey,
  name: r.name,
  islandId: r.island_id,
  role: r.role,
  instructions: r.instructions,
  tools: parseTools(r.tools),
  status: r.status as Bot['status'],
  taskId: r.task_id,
  locationKey: r.location_key as PlotKey,
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
  updatedAt: r.updated_at,
});

export interface ProjectRow {
  id: string;
  name: string;
  goal: string;
  status: string;
  color: string;
  created_at: number;
  updated_at: number;
}

export const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  goal: r.goal,
  status: r.status as Project['status'],
  color: r.color,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  notes: string;
  type: string;
  status: string;
  priority: string;
  island_id: string;
  bot_id: string | null;
  progress: number;
  duration_seconds: number;
  needs_approval: number;
  blocker: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}

export const toTask = (r: TaskRow): Task => ({
  id: r.id,
  projectId: r.project_id,
  title: r.title,
  notes: r.notes,
  type: r.type as Task['type'],
  status: r.status as Task['status'],
  priority: r.priority as TaskPriority,
  islandId: r.island_id,
  botId: r.bot_id,
  progress: r.progress,
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
  bot_id: string;
  summary: string;
  status: string;
  requested_at: number;
  decided_at: number | null;
  note: string | null;
}

export const toApproval = (r: ApprovalRow): ApprovalRequest => ({
  id: r.id,
  taskId: r.task_id,
  botId: r.bot_id,
  summary: r.summary,
  status: r.status as ApprovalRequest['status'],
  requestedAt: r.requested_at,
  decidedAt: r.decided_at,
  note: r.note,
});

export interface ActivityRow {
  id: string;
  kind: string;
  message: string;
  project_id: string | null;
  task_id: string | null;
  bot_id: string | null;
  island_id: string | null;
  at: number;
}

export const toActivity = (r: ActivityRow): ActivityEvent => ({
  id: r.id,
  kind: r.kind as ActivityEvent['kind'],
  message: r.message,
  projectId: r.project_id,
  taskId: r.task_id,
  botId: r.bot_id,
  islandId: r.island_id,
  at: r.at,
});
