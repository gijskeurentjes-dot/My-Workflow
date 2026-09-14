import type { ActivityEvent } from '@ai-islands/shared';
import type { Db } from '../../db/sqlite.js';
import type { ActivityFilter, ActivityRepository } from '../types.js';
import { toActivity, type ActivityRow } from './rows.js';

/** Hard ceiling on a single query, so a bad `limit` cannot read the whole log. */
const MAX_LIMIT = 500;

export function createActivityRepository(db: Db): ActivityRepository {
  const insert = db.prepare(`
    INSERT INTO activity_events (id, kind, message, project_id, task_id, bot_id, island_id, at)
    VALUES (@id, @kind, @message, @project_id, @task_id, @bot_id, @island_id, @at)
  `);

  return {
    list: (filter: ActivityFilter = {}) => {
      const where: string[] = [];
      const params: unknown[] = [];
      const columns = {
        projectId: 'project_id',
        taskId: 'task_id',
        botId: 'bot_id',
        islandId: 'island_id',
        kind: 'kind',
      } as const;

      for (const key of Object.keys(columns) as (keyof typeof columns)[]) {
        const value = filter[key];
        if (value === undefined) continue;
        where.push(`${columns[key]} = ?`);
        params.push(value);
      }

      const limit = Math.min(MAX_LIMIT, Math.max(1, filter.limit ?? 100));
      const sql = `
        SELECT * FROM activity_events
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY at DESC, rowid DESC
        LIMIT ?
      `;
      return (db.prepare(sql).all(...params, limit) as ActivityRow[]).map(toActivity);
    },

    create: (event: ActivityEvent) => {
      insert.run({
        id: event.id,
        kind: event.kind,
        message: event.message,
        project_id: event.projectId,
        task_id: event.taskId,
        bot_id: event.botId,
        island_id: event.islandId,
        at: event.at,
      });
      return event;
    },
  };
}
