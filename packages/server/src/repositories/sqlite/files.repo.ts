import type { Id, ProjectFile } from '@ai-islands/shared';
import type { Db } from '../../db/sqlite.js';
import type { ProjectFileRepository } from '../types.js';
import { toProjectFile, type ProjectFileRow } from './rows.js';

/**
 * The project's file register.
 *
 * References, not bytes — a name, a kind and where it lives. Newest first,
 * because the thing you want is almost always the thing that just appeared.
 */
export function createProjectFileRepository(db: Db): ProjectFileRepository {
  const selectAll = db.prepare('SELECT * FROM project_files ORDER BY created_at DESC');
  const selectByProject = db.prepare(
    'SELECT * FROM project_files WHERE project_id = ? ORDER BY created_at DESC',
  );
  const selectByTask = db.prepare(
    'SELECT * FROM project_files WHERE task_id = ? ORDER BY created_at DESC',
  );
  const selectById = db.prepare('SELECT * FROM project_files WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO project_files (id, project_id, task_id, agent_id, name, kind, location,
                               note, created_at)
    VALUES (@id, @project_id, @task_id, @agent_id, @name, @kind, @location,
            @note, @created_at)
  `);
  const remove = db.prepare('DELETE FROM project_files WHERE id = ?');

  return {
    list: (filter?: { projectId?: Id; taskId?: Id }) => {
      if (filter?.taskId) {
        return (selectByTask.all(filter.taskId) as ProjectFileRow[]).map(toProjectFile);
      }
      if (filter?.projectId) {
        return (selectByProject.all(filter.projectId) as ProjectFileRow[]).map(toProjectFile);
      }
      return (selectAll.all() as ProjectFileRow[]).map(toProjectFile);
    },

    findById: (id: Id) => {
      const row = selectById.get(id) as ProjectFileRow | undefined;
      return row ? toProjectFile(row) : null;
    },

    create: (file: ProjectFile) => {
      insert.run({
        id: file.id,
        project_id: file.projectId,
        task_id: file.taskId,
        agent_id: file.agentId,
        name: file.name,
        kind: file.kind,
        location: file.location,
        note: file.note,
        created_at: file.createdAt,
      });
      return file;
    },

    delete: (id: Id) => remove.run(id).changes > 0,
  };
}
