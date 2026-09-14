import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { MIGRATIONS } from './migrations.js';

export type Db = Database.Database;

/**
 * Open a database and bring its schema up to date.
 *
 * Pass ':memory:' for tests. Everything above this function talks to the
 * repository interfaces rather than to `Db` directly, so the driver stays
 * replaceable.
 */
export function openDatabase(file: string = config.databasePath): Db {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

/** Apply any migrations this database has not seen yet. */
export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((r) => (r as { id: number }).id),
  );

  const record = db.prepare(
    'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    // One transaction per migration: a failure leaves the database on the last
    // version that did apply cleanly, rather than half-way through this one.
    const run = db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.id, migration.name, Date.now());
    });
    run();
  }
}

/** Drop every table this app owns. Used by the demo-data reset. */
export function dropAll(db: Db): void {
  const drop = db.transaction(() => {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE IF EXISTS activity_events;
      DROP TABLE IF EXISTS approval_requests;
      DROP TABLE IF EXISTS tasks;
      DROP TABLE IF EXISTS bots;
      DROP TABLE IF EXISTS projects;
      DROP TABLE IF EXISTS islands;
      DROP TABLE IF EXISTS schema_migrations;
      PRAGMA foreign_keys = ON;
    `);
  });
  drop();
}
