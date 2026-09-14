import type { Id, Project, ProjectStatus } from '@ai-islands/shared';
import type { Db } from '../../db/sqlite.js';
import type { ProjectRepository } from '../types.js';
import { toProject, type ProjectRow } from './rows.js';

export function createProjectRepository(db: Db): ProjectRepository {
  const selectAll = db.prepare('SELECT * FROM projects ORDER BY created_at DESC');
  const selectByStatus = db.prepare(
    'SELECT * FROM projects WHERE status = ? ORDER BY created_at DESC',
  );
  const selectById = db.prepare('SELECT * FROM projects WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO projects (id, name, goal, status, color, created_at, updated_at)
    VALUES (@id, @name, @goal, @status, @color, @created_at, @updated_at)
  `);
  const remove = db.prepare('DELETE FROM projects WHERE id = ?');

  const read = (id: Id): Project | null => {
    const row = selectById.get(id) as ProjectRow | undefined;
    return row ? toProject(row) : null;
  };

  return {
    list: (filter?: { status?: ProjectStatus }) => {
      const rows = (filter?.status ? selectByStatus.all(filter.status) : selectAll.all()) as ProjectRow[];
      return rows.map(toProject);
    },

    findById: read,

    create: (project: Project) => {
      insert.run({
        id: project.id,
        name: project.name,
        goal: project.goal,
        status: project.status,
        color: project.color,
        created_at: project.createdAt,
        updated_at: project.updatedAt,
      });
      return project;
    },

    update: (id, patch) => {
      const sets: string[] = [];
      const params: Record<string, unknown> = { id };
      for (const field of ['name', 'goal', 'status', 'color'] as const) {
        if (patch[field] !== undefined) {
          sets.push(`${field} = @${field}`);
          params[field] = patch[field];
        }
      }
      if (sets.length === 0) return read(id);

      sets.push('updated_at = @updated_at');
      params.updated_at = Date.now();
      db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = @id`).run(params);
      return read(id);
    },

    delete: (id: Id) => remove.run(id).changes > 0,
  };
}
