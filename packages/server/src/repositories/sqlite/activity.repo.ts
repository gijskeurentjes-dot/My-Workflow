import type { ActivityEvent } from '@ai-islands/shared';
import type { Db } from '../../db/sqlite.js';
import type { ActivityFilter, ActivityRepository } from '../types.js';
import { toActivity, type ActivityRow } from './rows.js';

/** Hard ceiling on a single query, so a bad `limit` cannot read the whole log. */
const MAX_LIMIT = 500;

export function createActivityRepository(db: Db): ActivityRepository {
  const insert = db.prepare(`
    INSERT INTO activity_events (id, project_id, agent_id, task_id, event_type, message, timestamp)
    VALUES (@id, @project_id, @agent_id, @task_id, @event_type, @message, @timestamp)
  `);

  return {
    list: (filter: ActivityFilter = {}) => {
      const where: string[] = [];
      const params: unknown[] = [];
      const columns = {
        projectId: 'project_id',
        taskId: 'task_id',
        agentId: 'agent_id',
        eventType: 'event_type',
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
        ORDER BY timestamp DESC, rowid DESC
        LIMIT ?
      `;
      return (db.prepare(sql).all(...params, limit) as ActivityRow[]).map(toActivity);
    },

    create: (event: ActivityEvent) => {
      insert.run({
        id: event.id,
        project_id: event.projectId,
        agent_id: event.agentId,
        task_id: event.taskId,
        event_type: event.eventType,
        message: event.message,
        timestamp: event.timestamp,
      });
      return event;
    },
  };
}
