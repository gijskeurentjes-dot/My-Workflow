import type { Id, Project, ProjectStatus } from '@ai-islands/shared';
import type { Db } from '../../db/sqlite.js';
import type { ProjectPatch, ProjectRepository } from '../types.js';
import { toProject, type ProjectRow } from './rows.js';

export function createProjectRepository(db: Db): ProjectRepository {
  const selectAll = db.prepare('SELECT * FROM projects ORDER BY layout_row, layout_col, created_at');
  const selectByStatus = db.prepare(
    'SELECT * FROM projects WHERE status = ? ORDER BY layout_row, layout_col, created_at',
  );
  const selectById = db.prepare('SELECT * FROM projects WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO projects (id, name, goal, description, status, color,
                          biome, seed, layout_col, layout_row, crates,
                          created_at, updated_at)
    VALUES (@id, @name, @description, @description, @status, @color,
            @biome, @seed, @layout_col, @layout_row, @crates,
            @created_at, @updated_at)
  `);
  const remove = db.prepare('DELETE FROM projects WHERE id = ?');
  const bumpCrate = db.prepare('UPDATE projects SET crates = crates + 1 WHERE id = ?');
  const countAll = db.prepare('SELECT COUNT(*) AS c FROM projects');

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

    count: () => (countAll.get() as { c: number }).c,

    create: (project: Project) => {
      insert.run({
        id: project.id,
        name: project.name,
        // `goal` is the pre-rename column; still NOT NULL, so it is kept in
        // step with description rather than left empty.
        description: project.description,
        status: project.status,
        color: project.color,
        biome: project.appearance.biome,
        seed: project.appearance.seed,
        layout_col: project.appearance.layout.col,
        layout_row: project.appearance.layout.row,
        crates: project.crates,
        created_at: project.createdAt,
        updated_at: project.updatedAt,
      });
      return project;
    },

    update: (id: Id, patch: ProjectPatch) => {
      const sets: string[] = [];
      const params: Record<string, unknown> = { id };

      if (patch.name !== undefined) {
        sets.push('name = @name');
        params.name = patch.name;
      }
      if (patch.description !== undefined) {
        // Both columns move together while the old one still exists.
        sets.push('description = @description', 'goal = @description');
        params.description = patch.description;
      }
      if (patch.status !== undefined) {
        sets.push('status = @status');
        params.status = patch.status;
      }
      if (patch.color !== undefined) {
        sets.push('color = @color');
        params.color = patch.color;
      }

      if (sets.length === 0) return read(id);

      sets.push('updated_at = @updated_at');
      params.updated_at = Date.now();
      db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = @id`).run(params);
      return read(id);
    },

    delete: (id: Id) => remove.run(id).changes > 0,

    addCrate: (id: Id) => {
      bumpCrate.run(id);
      return read(id);
    },
  };
}
