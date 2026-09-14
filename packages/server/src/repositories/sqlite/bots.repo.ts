import type { Bot, BotKey, Id } from '@ai-islands/shared';
import type { Db } from '../../db/sqlite.js';
import type { BotPatch, BotRepository } from '../types.js';
import { toBot, type BotRow } from './rows.js';

export function createBotRepository(db: Db): BotRepository {
  const selectAll = db.prepare('SELECT * FROM bots ORDER BY name');
  const selectById = db.prepare('SELECT * FROM bots WHERE id = ?');
  const selectByKey = db.prepare('SELECT * FROM bots WHERE key = ?');
  const selectByIsland = db.prepare('SELECT * FROM bots WHERE island_id = ? ORDER BY name');
  const insert = db.prepare(`
    INSERT INTO bots (id, key, name, island_id, status, task_id, location_key,
                      move_from, move_to, move_departed, move_arrives, progress, updated_at)
    VALUES (@id, @key, @name, @island_id, @status, @task_id, @location_key,
            @move_from, @move_to, @move_departed, @move_arrives, @progress, @updated_at)
  `);

  const read = (id: Id): Bot | null => {
    const row = selectById.get(id) as BotRow | undefined;
    return row ? toBot(row) : null;
  };

  return {
    list: () => (selectAll.all() as BotRow[]).map(toBot),
    findById: read,

    findByKey: (key: BotKey) => {
      const row = selectByKey.get(key) as BotRow | undefined;
      return row ? toBot(row) : null;
    },

    findByIsland: (islandId: Id) => (selectByIsland.all(islandId) as BotRow[]).map(toBot),

    create: (bot: Bot) => {
      insert.run({
        id: bot.id,
        key: bot.key,
        name: bot.name,
        island_id: bot.islandId,
        status: bot.status,
        task_id: bot.taskId,
        location_key: bot.locationKey,
        move_from: bot.movement?.fromKey ?? null,
        move_to: bot.movement?.toKey ?? null,
        move_departed: bot.movement?.departedAt ?? null,
        move_arrives: bot.movement?.arrivesAt ?? null,
        progress: bot.progress,
        updated_at: bot.updatedAt,
      });
      return bot;
    },

    /**
     * Patch only the fields present. `movement` is four columns behind one
     * property, so it is expanded here rather than leaking into callers.
     */
    update: (id: Id, patch: BotPatch) => {
      const sets: string[] = [];
      const params: Record<string, unknown> = { id };

      if (patch.status !== undefined) {
        sets.push('status = @status');
        params.status = patch.status;
      }
      if (patch.taskId !== undefined) {
        sets.push('task_id = @task_id');
        params.task_id = patch.taskId;
      }
      if (patch.islandId !== undefined) {
        sets.push('island_id = @island_id');
        params.island_id = patch.islandId;
      }
      if (patch.locationKey !== undefined) {
        sets.push('location_key = @location_key');
        params.location_key = patch.locationKey;
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
      if (patch.progress !== undefined) {
        sets.push('progress = @progress');
        params.progress = patch.progress;
      }

      if (sets.length === 0) return read(id);

      sets.push('updated_at = @updated_at');
      params.updated_at = patch.updatedAt ?? Date.now();

      db.prepare(`UPDATE bots SET ${sets.join(', ')} WHERE id = @id`).run(params);
      return read(id);
    },
  };
}
