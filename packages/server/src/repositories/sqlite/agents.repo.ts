import type { Agent, Id } from '@ai-islands/shared';
import type { Db } from '../../db/sqlite.js';
import type { AgentPatch, AgentRepository } from '../types.js';
import { toAgent, type AgentRow } from './rows.js';

export function createAgentRepository(db: Db): AgentRepository {
  const selectAll = db.prepare('SELECT * FROM agents ORDER BY created_at, name');
  const selectById = db.prepare('SELECT * FROM agents WHERE id = ?');
  const selectByProject = db.prepare(
    'SELECT * FROM agents WHERE project_id = ? ORDER BY created_at, name',
  );
  const insert = db.prepare(`
    INSERT INTO agents (id, project_id, archetype, name, role, instructions, tools,
                        status, current_task_id, current_location,
                        move_from, move_to, move_departed, move_arrives,
                        progress, created_at, updated_at)
    VALUES (@id, @project_id, @archetype, @name, @role, @instructions, @tools,
            @status, @current_task_id, @current_location,
            @move_from, @move_to, @move_departed, @move_arrives,
            @progress, @created_at, @updated_at)
  `);
  const remove = db.prepare('DELETE FROM agents WHERE id = ?');

  const read = (id: Id): Agent | null => {
    const row = selectById.get(id) as AgentRow | undefined;
    return row ? toAgent(row) : null;
  };

  return {
    list: () => (selectAll.all() as AgentRow[]).map(toAgent),
    findById: read,
    findByProject: (projectId: Id) =>
      (selectByProject.all(projectId) as AgentRow[]).map(toAgent),

    create: (agent: Agent) => {
      insert.run({
        id: agent.id,
        project_id: agent.projectId,
        archetype: agent.archetype,
        name: agent.name,
        role: agent.role,
        instructions: agent.instructions,
        tools: JSON.stringify(agent.tools),
        status: agent.status,
        current_task_id: agent.currentTaskId,
        current_location: agent.currentLocation,
        move_from: agent.movement?.fromKey ?? null,
        move_to: agent.movement?.toKey ?? null,
        move_departed: agent.movement?.departedAt ?? null,
        move_arrives: agent.movement?.arrivesAt ?? null,
        progress: agent.progress,
        created_at: agent.createdAt,
        updated_at: agent.updatedAt,
      });
      return agent;
    },

    /**
     * Patch only the fields present. `movement` is four columns behind one
     * property, so it is expanded here rather than leaking into callers.
     */
    update: (id: Id, patch: AgentPatch) => {
      const sets: string[] = [];
      const params: Record<string, unknown> = { id };

      const simple: [keyof AgentPatch, string][] = [
        ['projectId', 'project_id'],
        ['name', 'name'],
        ['role', 'role'],
        ['instructions', 'instructions'],
        ['status', 'status'],
        ['currentTaskId', 'current_task_id'],
        ['currentLocation', 'current_location'],
        ['progress', 'progress'],
      ];
      for (const [key, column] of simple) {
        if (patch[key] === undefined) continue;
        sets.push(`${column} = @${column}`);
        params[column] = patch[key];
      }

      if (patch.tools !== undefined) {
        sets.push('tools = @tools');
        params.tools = JSON.stringify(patch.tools);
      }

      if (patch.movement !== undefined) {
        sets.push(
          'move_from = @move_from',
          'move_to = @move_to',
          'move_departed = @move_departed',
          'move_arrives = @move_arrives',
        );
        params.move_from = patch.movement?.fromKey ?? null;
        params.move_to = patch.movement?.toKey ?? null;
        params.move_departed = patch.movement?.departedAt ?? null;
        params.move_arrives = patch.movement?.arrivesAt ?? null;
      }

      if (sets.length === 0) return read(id);

      sets.push('updated_at = @updated_at');
      params.updated_at = patch.updatedAt ?? Date.now();

      db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = @id`).run(params);
      return read(id);
    },

    delete: (id: Id) => remove.run(id).changes > 0,
  };
}
