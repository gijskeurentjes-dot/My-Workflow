import { ACTIVE_TASK_STATUSES, type Id, type Task } from '@ai-islands/shared';
import type { Db } from '../../db/sqlite.js';
import type { TaskFilter, TaskPatch, TaskRepository } from '../types.js';
import { toTask, type TaskRow } from './rows.js';

export function createTaskRepository(db: Db): TaskRepository {
  const selectById = db.prepare('SELECT * FROM tasks WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO tasks (id, project_id, title, notes, type, status, island_id, bot_id,
                       progress, duration_seconds, needs_approval, blocker,
                       created_at, started_at, completed_at)
    VALUES (@id, @project_id, @title, @notes, @type, @status, @island_id, @bot_id,
            @progress, @duration_seconds, @needs_approval, @blocker,
            @created_at, @started_at, @completed_at)
  `);
  const remove = db.prepare('DELETE FROM tasks WHERE id = ?');

  // Tasks the engine can move forward: anything not finished and not sitting
  // untouched on the board.
  const advanceable = db.prepare(`
    SELECT * FROM tasks
    WHERE status IN (${ACTIVE_TASK_STATUSES.map(() => '?').join(', ')})
    ORDER BY created_at
  `);

  const read = (id: Id): Task | null => {
    const row = selectById.get(id) as TaskRow | undefined;
    return row ? toTask(row) : null;
  };

  return {
    list: (filter: TaskFilter = {}) => {
      const where: string[] = [];
      const params: unknown[] = [];

      if (filter.projectId) {
        where.push('project_id = ?');
        params.push(filter.projectId);
      }
      if (filter.islandId) {
        where.push('island_id = ?');
        params.push(filter.islandId);
      }
      if (filter.botId) {
        where.push('bot_id = ?');
        params.push(filter.botId);
      }
      if (filter.type) {
        where.push('type = ?');
        params.push(filter.type);
      }
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        where.push(`status IN (${statuses.map(() => '?').join(', ')})`);
        params.push(...statuses);
      }

      const sql = `SELECT * FROM tasks${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at`;
      return (db.prepare(sql).all(...params) as TaskRow[]).map(toTask);
    },

    findById: read,

    create: (task: Task) => {
      insert.run({
        id: task.id,
        project_id: task.projectId,
        title: task.title,
        notes: task.notes,
        type: task.type,
        status: task.status,
        island_id: task.islandId,
        bot_id: task.botId,
        progress: task.progress,
        duration_seconds: task.durationSeconds,
        needs_approval: task.needsApproval ? 1 : 0,
        blocker: task.blocker,
        created_at: task.createdAt,
        started_at: task.startedAt,
        completed_at: task.completedAt,
      });
      return task;
    },

    update: (id: Id, patch: TaskPatch) => {
      const columns: Record<keyof TaskPatch, string> = {
        title: 'title',
        notes: 'notes',
        status: 'status',
        botId: 'bot_id',
        progress: 'progress',
        needsApproval: 'needs_approval',
        blocker: 'blocker',
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
      db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = @id`).run(params);
      return read(id);
    },

    delete: (id: Id) => remove.run(id).changes > 0,

    listAdvanceable: () => (advanceable.all(...ACTIVE_TASK_STATUSES) as TaskRow[]).map(toTask),
  };
}
