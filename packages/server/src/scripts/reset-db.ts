/**
 * Wipe the database file and replay the demo seed.
 *
 * Run with `npm run db:reset`. Unlike the API's /api/reset this also drops the
 * schema, so it recovers a database left behind by an older migration set.
 */
import { config } from '../config.js';
import { seedWorld } from '../db/seed.js';
import { dropAll, migrate, openDatabase } from '../db/sqlite.js';
import { createSqliteRepositories } from '../repositories/sqlite/index.js';

const db = openDatabase(config.databasePath);
dropAll(db);
migrate(db);

const repos = createSqliteRepositories(db);
const world = seedWorld(repos);

console.log(`Reset ${config.databasePath}`);
console.log(
  `  ${world.islands.length} islands, ${world.bots.length} agents, ` +
    `${world.projects.length} projects, ${world.tasks.length} tasks`,
);
db.close();
