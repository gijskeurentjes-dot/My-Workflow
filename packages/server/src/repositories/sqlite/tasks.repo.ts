import { ACTIVE_TASK_STATUSES, type Id, type Task } from '@ai-islands/shared';
import type { Db } from '../../db/sqlite.js';
import type { TaskFilter, TaskPatch, TaskRepository } from '../types.js';
import { toTask, type TaskRow } from './rows.js';

/**
 * Urgent first, then oldest. Used by every listing and by the engine's pickup
 * order, so the board and what actually happens can never disagree.
 */
const PRIORITY_ORDER = `
  CASE priority
    WHEN 'urgent' THEN 0
    WHEN 'high'   THEN 1
    WHEN 'normal' THEN 2
    ELSE 3
  END, created_at
`;

export function createTaskRepository(db: Db): TaskRepository {
  const selectById = db.prepare('SELECT * FROM tasks WHERE id = ?');
  const selectDeps = db.prepare(
    'SELECT task_id, depends_on_id FROM task_dependencies ORDER BY created_at',
  );
  const selectDepsFor = db.prepare(
    'SELECT depends_on_id FROM task_dependencies WHERE task_id = ? ORDER BY created_at',
  );
  const insertDep = db.prepare(
    'INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id, created_at) VALUES (?, ?, ?)',
  );
  const deleteDep = db.prepare(
    'DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?',
  );
  const selectDependents = db.prepare(
    'SELECT task_id FROM task_dependencies WHERE depends_on_id = ?',
  );

  /**
   * Every edge in the graph, in one query.
   *
   * Listings hydrate from this rather than asking per row: a board with a
   * hundred tasks should cost two statements, not a hundred and one.
   */
  const dependencyMap = (): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    for (const row of selectDeps.all() as { task_id: string; depends_on_id: string }[]) {
      const list = map.get(row.task_id);
      if (list) list.push(row.depends_on_id);
      else map.set(row.task_id, [row.depends_on_id]);
    }
    return map;
  };

  const hydrate = (rows: TaskRow[]): Task[] => {
    const deps = dependencyMap();
    return rows.map((row) => toTask(row, deps.get(row.id) ?? []));
  };
  const insert = db.prepare(`
    INSERT INTO tasks (id, project_id, assigned_agent_id, title, description, type,
                       status, priority, building_key, progress, run_mode,
                       duration_seconds, needs_approval, blocker, parent_task_id,
                       milestone_id, created_at, updated_at, started_at, completed_at)
    VALUES (@id, @project_id, @assigned_agent_id, @title, @description, @type,
            @status, @priority, @building_key, @progress, @run_mode,
            @duration_seconds, @needs_approval, @blocker, @parent_task_id,
            @milestone_id, @created_at, @updated_at, @started_at, @completed_at)
  `);
  const remove = db.prepare('DELETE FROM tasks WHERE id = ?');

  const advanceable = db.prepare(`
    SELECT * FROM tasks
    WHERE status IN (${ACTIVE_TASK_STATUSES.map(() => '?').join(', ')})
    ORDER BY ${PRIORITY_ORDER}
  `);

  const read = (id: Id): Task | null => {
    const row = selectById.get(id) as TaskRow | undefined;
    if (!row) return null;
    const deps = (selectDepsFor.all(id) as { depends_on_id: string }[]).map((d) => d.depends_on_id);
    return toTask(row, deps);
  };

  return {
    list: (filter: TaskFilter = {}) => {
      const where: string[] = [];
      const params: unknown[] = [];

      const columns = {
        projectId: 'project_id',
        assignedAgentId: 'assigned_agent_id',
        type: 'type',
        priority: 'priority',
        buildingKey: 'building_key',
      } as const;

      for (const key of Object.keys(columns) as (keyof typeof columns)[]) {
        const value = filter[key];
        if (value === undefined) continue;
        where.push(`${columns[key]} = ?`);
        params.push(value);
      }

      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        where.push(`status IN (${statuses.map(() => '?').join(', ')})`);
        params.push(...statuses);
      }

      const sql = `SELECT * FROM tasks${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${PRIORITY_ORDER}`;
      return hydrate(db.prepare(sql).all(...params) as TaskRow[]);
    },

    findById: read,

    create: (task: Task) => {
      insert.run({
        id: task.id,
        project_id: task.projectId,
        assigned_agent_id: task.assignedAgentId,
        title: task.title,
        description: task.description,
        type: task.type,
        status: task.status,
        priority: task.priority,
        building_key: task.buildingKey,
        progress: task.progress,
        run_mode: task.runMode,
        duration_seconds: task.durationSeconds,
        needs_approval: task.needsApproval ? 1 : 0,
        blocker: task.blocker,
        parent_task_id: task.parentTaskId,
        milestone_id: task.milestoneId,
        created_at: task.createdAt,
        updated_at: task.updatedAt,
        started_at: task.startedAt,
        completed_at: task.completedAt,
      });
      return task;
    },

    update: (id: Id, patch: TaskPatch) => {
      const columns: Record<keyof TaskPatch, string> = {
        title: 'title',
        description: 'description',
        status: 'status',
        priority: 'priority',
        assignedAgentId: 'assigned_agent_id',
        progress: 'progress',
        runMode: 'run_mode',
        needsApproval: 'needs_approval',
        blocker: 'blocker',
        parentTaskId: 'parent_task_id',
        milestoneId: 'milestone_id',
        startedAt: 'started_at',
        completedAt: 'completed_at',
      };

      const sets: string[] = [];
      const params: Record<string, unknown> = { id };
      for (const key of Object.keys(columns) as (keyof TaskPatch)[]) {
        const value = patch[key];
        if (value === undefined) continue;
        const column = columns[key];
        sets.push(`${column} = @${column}`);
        params[column] = key === 'needsApproval' ? (value ? 1 : 0) : value;
      }

      if (sets.length === 0) return read(id);

      // Stamped here rather than by each caller, so it cannot go stale.
      sets.push('updated_at = @updated_at');
      params.updated_at = Date.now();

      db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = @id`).run(params);
      return read(id);
    },

    delete: (id: Id) => remove.run(id).changes > 0,

    listAdvanceable: () => hydrate(advanceable.all(...ACTIVE_TASK_STATUSES) as TaskRow[]),

    addDependency: (taskId: Id, dependsOnId: Id) => {
      insertDep.run(taskId, dependsOnId, Date.now());
      return read(taskId);
    },

    removeDependency: (taskId: Id, dependsOnId: Id) => {
      deleteDep.run(taskId, dependsOnId);
      return read(taskId);
    },

    listDependents: (taskId: Id) =>
      (selectDependents.all(taskId) as { task_id: string }[]).map((r) => r.task_id),
  };
}
