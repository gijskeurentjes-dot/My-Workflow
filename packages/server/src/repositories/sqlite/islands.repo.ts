import type { Id, Island, IslandKey } from '@ai-islands/shared';
import type { Db } from '../../db/sqlite.js';
import type { IslandRepository } from '../types.js';
import { toIsland, type IslandRow } from './rows.js';

export function createIslandRepository(db: Db): IslandRepository {
  const selectAll = db.prepare('SELECT * FROM islands ORDER BY layout_row, layout_col');
  const selectById = db.prepare('SELECT * FROM islands WHERE id = ?');
  const selectByKey = db.prepare('SELECT * FROM islands WHERE key = ?');
  const insert = db.prepare(`
    INSERT INTO islands (id, key, name, blurb, biome, seed, layout_col, layout_row, crates, created_at)
    VALUES (@id, @key, @name, @blurb, @biome, @seed, @layout_col, @layout_row, @crates, @created_at)
  `);
  const bumpCrate = db.prepare('UPDATE islands SET crates = crates + 1 WHERE id = ?');

  return {
    list: () => (selectAll.all() as IslandRow[]).map(toIsland),

    findById: (id: Id) => {
      const row = selectById.get(id) as IslandRow | undefined;
      return row ? toIsland(row) : null;
    },

    findByKey: (key: IslandKey) => {
      const row = selectByKey.get(key) as IslandRow | undefined;
      return row ? toIsland(row) : null;
    },

    create: (island: Island) => {
      insert.run({
        id: island.id,
        key: island.key,
        name: island.name,
        blurb: island.blurb,
        biome: island.biome,
        seed: island.seed,
        layout_col: island.layout.col,
        layout_row: island.layout.row,
        crates: island.crates,
        created_at: island.createdAt,
      });
      return island;
    },

    addCrate: (id: Id) => {
      bumpCrate.run(id);
      const row = selectById.get(id) as IslandRow | undefined;
      return row ? toIsland(row) : null;
    },
  };
}
