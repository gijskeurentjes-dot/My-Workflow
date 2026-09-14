/**
 * Schema migrations, applied in order and recorded in `schema_migrations`.
 *
 * The SQL is deliberately plain: TEXT ids, INTEGER epoch-millisecond
 * timestamps, and CHECK constraints instead of native enums. All of it is
 * valid PostgreSQL too, so porting means changing the driver, not the schema.
 */
export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'initial_world',
    sql: /* sql */ `
      CREATE TABLE islands (
        id          TEXT PRIMARY KEY,
        key         TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        blurb       TEXT NOT NULL DEFAULT '',
        biome       TEXT NOT NULL,
        seed        REAL NOT NULL,
        layout_col  INTEGER NOT NULL DEFAULT 0,
        layout_row  INTEGER NOT NULL DEFAULT 0,
        crates      INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL
      );

      CREATE TABLE projects (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        goal        TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'paused', 'archived')),
        color       TEXT NOT NULL DEFAULT '#4a8ff0',
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE bots (
        id            TEXT PRIMARY KEY,
        key           TEXT NOT NULL UNIQUE,
        name          TEXT NOT NULL,
        island_id     TEXT NOT NULL REFERENCES islands(id) ON DELETE CASCADE,
        status        TEXT NOT NULL DEFAULT 'idle'
                        CHECK (status IN ('idle', 'working', 'waiting_approval',
                                          'completed', 'paused', 'failed', 'cancelled')),
        task_id       TEXT,
        location_key  TEXT NOT NULL DEFAULT 'rest',
        -- Movement is null while the bot is standing still.
        move_from     TEXT,
        move_to       TEXT,
        move_departed INTEGER,
        move_arrives  INTEGER,
        progress      REAL NOT NULL DEFAULT 0,
        updated_at    INTEGER NOT NULL
      );

      CREATE TABLE tasks (
        id               TEXT PRIMARY KEY,
        project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title            TEXT NOT NULL,
        notes            TEXT NOT NULL DEFAULT '',
        type             TEXT NOT NULL
                           CHECK (type IN ('planning', 'research', 'coding',
                                           'writing', 'analysis', 'review')),
        status           TEXT NOT NULL DEFAULT 'backlog'
                           CHECK (status IN ('backlog', 'working', 'waiting_approval',
                                             'delivering', 'completed', 'paused',
                                             'failed', 'cancelled')),
        island_id        TEXT NOT NULL REFERENCES islands(id) ON DELETE CASCADE,
        bot_id           TEXT REFERENCES bots(id) ON DELETE SET NULL,
        progress         REAL NOT NULL DEFAULT 0,
        duration_seconds INTEGER NOT NULL DEFAULT 120,
        needs_approval   INTEGER NOT NULL DEFAULT 1,
        blocker          TEXT,
        created_at       INTEGER NOT NULL,
        started_at       INTEGER,
        completed_at     INTEGER
      );

      CREATE TABLE approval_requests (
        id            TEXT PRIMARY KEY,
        task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        bot_id        TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
        summary       TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected')),
        requested_at  INTEGER NOT NULL,
        decided_at    INTEGER,
        note          TEXT
      );

      CREATE TABLE activity_events (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL,
        message     TEXT NOT NULL,
        project_id  TEXT,
        task_id     TEXT,
        bot_id      TEXT,
        island_id   TEXT,
        at          INTEGER NOT NULL
      );

      CREATE INDEX idx_tasks_project    ON tasks(project_id);
      CREATE INDEX idx_tasks_island     ON tasks(island_id);
      CREATE INDEX idx_tasks_bot        ON tasks(bot_id);
      CREATE INDEX idx_tasks_status     ON tasks(status);
      CREATE INDEX idx_bots_island      ON bots(island_id);
      CREATE INDEX idx_approvals_status ON approval_requests(status);
      CREATE INDEX idx_activity_at      ON activity_events(at DESC);
      CREATE INDEX idx_activity_project ON activity_events(project_id);
    `,
  },
];
