import type { Id, Milestone } from '@ai-islands/shared';
import type { Db } from '../../db/sqlite.js';
import type { MilestonePatch, MilestoneRepository } from '../types.js';
import { toMilestone, type MilestoneRow } from './rows.js';

/**
 * Milestones, oldest deadline first.
 *
 * Ordered by due date with undated ones last, because a list of milestones is
 * read as "what is coming" — and something with no date is never what is next.
 */
const ORDER = 'CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at, created_at';

export function createMilestoneRepository(db: Db): MilestoneRepository {
  const selectAll = db.prepare(`SELECT * FROM milestones ORDER BY ${ORDER}`);
  const selectByProject = db.prepare(
    `SELECT * FROM milestones WHERE project_id = ? ORDER BY ${ORDER}`,
  );
  const selectById = db.prepare('SELECT * FROM milestones WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO milestones (id, project_id, title, description, due_at, status,
                            created_at, updated_at)
    VALUES (@id, @project_id, @title, @description, @due_at, @status,
            @created_at, @updated_at)
  `);
  const remove = db.prepare('DELETE FROM milestones WHERE id = ?');

  const read = (id: Id): Milestone | null => {
    const row = selectById.get(id) as MilestoneRow | undefined;
    return row ? toMilestone(row) : null;
  };

  return {
    list: (projectId?: Id) =>
      (
        (projectId ? selectByProject.all(projectId) : selectAll.all()) as MilestoneRow[]
      ).map(toMilestone),

    findById: read,

    create: (milestone: Milestone) => {
      insert.run({
        id: milestone.id,
        project_id: milestone.projectId,
        title: milestone.title,
        description: milestone.description,
        due_at: milestone.dueAt,
        status: milestone.status,
        created_at: milestone.createdAt,
        updated_at: milestone.updatedAt,
      });
      return milestone;
    },

    update: (id: Id, patch: MilestonePatch) => {
      const columns: Record<keyof MilestonePatch, string> = {
        title: 'title',
        description: 'description',
        dueAt: 'due_at',
        status: 'status',
      };

      const sets: string[] = [];
      const params: Record<string, unknown> = { id };
      for (const key of Object.keys(columns) as (keyof MilestonePatch)[]) {
        const value = patch[key];
        if (value === undefined) continue;
        sets.push(`${columns[key]} = @${columns[key]}`);
        params[columns[key]] = value;
      }
      if (sets.length === 0) return read(id);

      sets.push('updated_at = @updated_at');
      params.updated_at = Date.now();
      db.prepare(`UPDATE milestones SET ${sets.join(', ')} WHERE id = @id`).run(params);
      return read(id);
    },

    delete: (id: Id) => remove.run(id).changes > 0,
  };
}
