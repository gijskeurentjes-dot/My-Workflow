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
  {
    id: 2,
    name: 'task_priority_and_agent_briefs',
    sql: /* sql */ `
      -- Priority orders the board and decides who gets picked up first.
      ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';

      -- Every task now records when it last changed, not only when it started
      -- and finished.
      ALTER TABLE tasks ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
      UPDATE tasks SET updated_at = created_at WHERE updated_at = 0;

      -- An agent's brief becomes data rather than a compile-time constant:
      -- 'instructions' is what a real engine would send as a system prompt, and
      -- 'tools' is what it would be allowed to reach for. Both are editable.
      ALTER TABLE bots ADD COLUMN role TEXT NOT NULL DEFAULT '';
      ALTER TABLE bots ADD COLUMN instructions TEXT NOT NULL DEFAULT '';
      ALTER TABLE bots ADD COLUMN tools TEXT NOT NULL DEFAULT '[]';

      CREATE INDEX idx_tasks_priority ON tasks(priority);
    `,
  },
  {
    id: 3,
    name: 'projects_are_islands',
    sql: /* sql */ `
      -- One project is now one island, and every project has its own team.
      -- Islands stop being entities: their appearance moves onto the project.
      ALTER TABLE projects ADD COLUMN description  TEXT    NOT NULL DEFAULT '';
      ALTER TABLE projects ADD COLUMN biome        TEXT    NOT NULL DEFAULT 'civic';
      ALTER TABLE projects ADD COLUMN seed         REAL    NOT NULL DEFAULT 1.2;
      ALTER TABLE projects ADD COLUMN layout_col   INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE projects ADD COLUMN layout_row   INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE projects ADD COLUMN crates       INTEGER NOT NULL DEFAULT 0;

      -- 'goal' becomes 'description' to match the platform spec.
      UPDATE projects SET description = goal WHERE description = '';

      -- Give each existing project a distinct island rather than five identical
      -- ones. rowid is stable and already orders them by creation.
      UPDATE projects SET
        biome = (
          SELECT value FROM (
            SELECT 0 AS i, 'civic'   AS value UNION ALL SELECT 1, 'scholar'
            UNION ALL SELECT 2, 'forge' UNION ALL SELECT 3, 'studio'
            UNION ALL SELECT 4, 'ledger'
          ) WHERE i = ((SELECT COUNT(*) FROM projects p2 WHERE p2.rowid < projects.rowid) % 5)
        ),
        seed = 1.2 + (((SELECT COUNT(*) FROM projects p2 WHERE p2.rowid < projects.rowid) * 2.7) - 
               (CAST((((SELECT COUNT(*) FROM projects p2 WHERE p2.rowid < projects.rowid) * 2.7) / 9) AS INTEGER) * 9)),
        layout_col = (SELECT COUNT(*) FROM projects p2 WHERE p2.rowid < projects.rowid) % 3,
        layout_row = (SELECT COUNT(*) FROM projects p2 WHERE p2.rowid < projects.rowid) / 3;

      -- Carry delivered crates over from the islands the work was done on.
      UPDATE projects SET crates = (
        SELECT COUNT(*) FROM tasks t
        WHERE t.project_id = projects.id AND t.status = 'completed'
      );

      -- ── Agents ────────────────────────────────────────────────────────────
      -- Rebuilt rather than altered: the table is renamed, re-keyed onto
      -- projects, and its location vocabulary changes at the same time.
      CREATE TABLE agents (
        id               TEXT PRIMARY KEY,
        project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        archetype        TEXT NOT NULL,
        name             TEXT NOT NULL,
        role             TEXT NOT NULL DEFAULT '',
        instructions     TEXT NOT NULL DEFAULT '',
        tools            TEXT NOT NULL DEFAULT '[]',
        status           TEXT NOT NULL DEFAULT 'idle'
                           CHECK (status IN ('idle', 'working', 'waiting_approval',
                                             'completed', 'paused', 'failed', 'cancelled')),
        current_task_id  TEXT,
        current_location TEXT NOT NULL DEFAULT 'rest',
        move_from        TEXT,
        move_to          TEXT,
        move_departed    INTEGER,
        move_arrives     INTEGER,
        progress         REAL NOT NULL DEFAULT 0,
        created_at       INTEGER NOT NULL,
        updated_at       INTEGER NOT NULL
      );

      -- Existing agents belonged to a work area, not a project, so there is no
      -- correct project for them. They join the oldest one; other projects
      -- start empty and you hire into them.
      INSERT INTO agents (id, project_id, archetype, name, role, instructions, tools,
                          status, current_task_id, current_location,
                          move_from, move_to, move_departed, move_arrives,
                          progress, created_at, updated_at)
      SELECT
        b.id,
        (SELECT id FROM projects ORDER BY created_at, rowid LIMIT 1),
        CASE b.key
          WHEN 'atlas'        THEN 'pm'
          WHEN 'nova'         THEN 'researcher'
          WHEN 'forge'        THEN 'developer'
          WHEN 'slidebuilder' THEN 'presenter'
          WHEN 'excel-expert' THEN 'analyst'
          ELSE 'pm'
        END,
        b.name, b.role, b.instructions, b.tools,
        b.status, b.task_id,
        -- The old five plots map onto the new eight.
        CASE b.location_key
          WHEN 'workbench' THEN 'hq'
          WHEN 'approval'  THEN 'hq'
          WHEN 'depot'     THEN 'depot'
          WHEN 'gate'      THEN 'gate'
          ELSE 'rest'
        END,
        NULL, NULL, NULL, NULL,
        b.progress, b.updated_at, b.updated_at
      FROM bots b
      WHERE EXISTS (SELECT 1 FROM projects);

      DROP TABLE bots;

      -- ── Tasks ─────────────────────────────────────────────────────────────
      -- Rebuilt so the foreign key points at agents rather than the dropped
      -- bots table, and so the island reference goes away for good.
      CREATE TABLE tasks_new (
        id                TEXT PRIMARY KEY,
        project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        assigned_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        title             TEXT NOT NULL,
        description       TEXT NOT NULL DEFAULT '',
        type              TEXT NOT NULL
                            CHECK (type IN ('planning', 'research', 'coding',
                                            'writing', 'analysis', 'review')),
        status            TEXT NOT NULL DEFAULT 'backlog'
                            CHECK (status IN ('backlog', 'working', 'waiting_approval',
                                              'delivering', 'completed', 'paused',
                                              'failed', 'cancelled')),
        priority          TEXT NOT NULL DEFAULT 'normal'
                            CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
        building_key      TEXT NOT NULL DEFAULT 'hq',
        progress          REAL NOT NULL DEFAULT 0,
        duration_seconds  INTEGER NOT NULL DEFAULT 120,
        needs_approval    INTEGER NOT NULL DEFAULT 1,
        blocker           TEXT,
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL,
        started_at        INTEGER,
        completed_at      INTEGER
      );

      INSERT INTO tasks_new (id, project_id, assigned_agent_id, title, description, type,
                             status, priority, building_key, progress, duration_seconds,
                             needs_approval, blocker, created_at, updated_at,
                             started_at, completed_at)
      SELECT
        t.id, t.project_id,
        CASE WHEN t.bot_id IN (SELECT id FROM agents) THEN t.bot_id ELSE NULL END,
        t.title, t.notes, t.type, t.status, t.priority,
        CASE t.type
          WHEN 'research' THEN 'library'
          WHEN 'coding'   THEN 'workshop'
          WHEN 'writing'  THEN 'studio'
          WHEN 'analysis' THEN 'data'
          ELSE 'hq'
        END,
        t.progress, t.duration_seconds, t.needs_approval, t.blocker,
        t.created_at, t.updated_at, t.started_at, t.completed_at
      FROM tasks t;

      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;

      -- ── Approvals ─────────────────────────────────────────────────────────
      CREATE TABLE approvals_new (
        id           TEXT PRIMARY KEY,
        task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        summary      TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'rejected')),
        requested_at INTEGER NOT NULL,
        decided_at   INTEGER,
        note         TEXT
      );

      -- A request whose agent did not survive the move has nobody to act on it.
      INSERT INTO approvals_new (id, task_id, agent_id, summary, status,
                                 requested_at, decided_at, note)
      SELECT a.id, a.task_id, a.bot_id, a.summary, a.status,
             a.requested_at, a.decided_at, a.note
      FROM approval_requests a
      WHERE a.bot_id IN (SELECT id FROM agents)
        AND a.task_id IN (SELECT id FROM tasks);

      DROP TABLE approval_requests;
      ALTER TABLE approvals_new RENAME TO approval_requests;

      -- ── Activity ──────────────────────────────────────────────────────────
      -- Rebuilt to rename its columns onto the platform vocabulary. History is
      -- kept: an entry naming an agent that is gone still reads correctly.
      CREATE TABLE activity_new (
        id         TEXT PRIMARY KEY,
        project_id TEXT,
        agent_id   TEXT,
        task_id    TEXT,
        event_type TEXT NOT NULL,
        message    TEXT NOT NULL,
        timestamp  INTEGER NOT NULL
      );

      INSERT INTO activity_new (id, project_id, agent_id, task_id, event_type, message, timestamp)
      SELECT id, project_id, bot_id, task_id, kind, message, at FROM activity_events;

      DROP TABLE activity_events;
      ALTER TABLE activity_new RENAME TO activity_events;

      CREATE INDEX idx_activity_ts      ON activity_events(timestamp DESC);
      CREATE INDEX idx_activity_project ON activity_events(project_id);
      CREATE INDEX idx_tasks_project    ON tasks(project_id);
      CREATE INDEX idx_tasks_agent      ON tasks(assigned_agent_id);
      CREATE INDEX idx_tasks_status     ON tasks(status);
      CREATE INDEX idx_tasks_priority   ON tasks(priority);
      CREATE INDEX idx_approvals_status ON approval_requests(status);
      DROP TABLE IF EXISTS islands;

      CREATE INDEX idx_agents_project ON agents(project_id);
      CREATE INDEX idx_tasks_building ON tasks(building_key);
    `,
  },
  {
    id: 4,
    name: 'real_agent_runtime',
    sql: /* sql */ `
      -- Execution limits, so a run cannot spend unbounded time or tokens.
      ALTER TABLE agents ADD COLUMN model             TEXT    NOT NULL DEFAULT 'claude-opus-5';
      ALTER TABLE agents ADD COLUMN max_execution_ms  INTEGER NOT NULL DEFAULT 180000;
      ALTER TABLE agents ADD COLUMN max_output_tokens INTEGER NOT NULL DEFAULT 16000;
      ALTER TABLE agents ADD COLUMN requires_approval INTEGER NOT NULL DEFAULT 1;

      -- 'queued' joins the state machine: accepted, not yet started.
      -- Both tables carry a CHECK, so both are rebuilt rather than altered.
      CREATE TABLE agents_new (
        id                TEXT PRIMARY KEY,
        project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        archetype         TEXT NOT NULL,
        name              TEXT NOT NULL,
        role              TEXT NOT NULL DEFAULT '',
        instructions      TEXT NOT NULL DEFAULT '',
        tools             TEXT NOT NULL DEFAULT '[]',
        model             TEXT NOT NULL DEFAULT 'claude-opus-5',
        max_execution_ms  INTEGER NOT NULL DEFAULT 180000,
        max_output_tokens INTEGER NOT NULL DEFAULT 16000,
        requires_approval INTEGER NOT NULL DEFAULT 1,
        status            TEXT NOT NULL DEFAULT 'idle'
                            CHECK (status IN ('idle', 'queued', 'working', 'waiting_approval',
                                              'completed', 'paused', 'failed', 'cancelled')),
        current_task_id   TEXT,
        current_location  TEXT NOT NULL DEFAULT 'rest',
        move_from         TEXT,
        move_to           TEXT,
        move_departed     INTEGER,
        move_arrives      INTEGER,
        progress          REAL NOT NULL DEFAULT 0,
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL
      );
      INSERT INTO agents_new SELECT
        id, project_id, archetype, name, role, instructions, tools,
        model, max_execution_ms, max_output_tokens, requires_approval,
        status, current_task_id, current_location,
        move_from, move_to, move_departed, move_arrives,
        progress, created_at, updated_at
      FROM agents;
      DROP TABLE agents;
      ALTER TABLE agents_new RENAME TO agents;

      CREATE TABLE tasks_new (
        id                TEXT PRIMARY KEY,
        project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        assigned_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        title             TEXT NOT NULL,
        description       TEXT NOT NULL DEFAULT '',
        type              TEXT NOT NULL
                            CHECK (type IN ('planning', 'research', 'coding',
                                            'writing', 'analysis', 'review')),
        status            TEXT NOT NULL DEFAULT 'backlog'
                            CHECK (status IN ('backlog', 'queued', 'working', 'waiting_approval',
                                              'delivering', 'completed', 'paused',
                                              'failed', 'cancelled')),
        priority          TEXT NOT NULL DEFAULT 'normal'
                            CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
        building_key      TEXT NOT NULL DEFAULT 'hq',
        progress          REAL NOT NULL DEFAULT 0,
        duration_seconds  INTEGER NOT NULL DEFAULT 120,
        needs_approval    INTEGER NOT NULL DEFAULT 1,
        blocker           TEXT,
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL,
        started_at        INTEGER,
        completed_at      INTEGER
      );
      INSERT INTO tasks_new SELECT
        id, project_id, assigned_agent_id, title, description, type, status, priority,
        building_key, progress, duration_seconds, needs_approval, blocker,
        created_at, updated_at, started_at, completed_at
      FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;

      -- What an agent produced. Kept separate from the task so a rerun does not
      -- overwrite the previous attempt.
      CREATE TABLE task_results (
        id                    TEXT PRIMARY KEY,
        task_id               TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id              TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        summary               TEXT NOT NULL DEFAULT '',
        report                TEXT,
        raw_text              TEXT NOT NULL DEFAULT '',
        model                 TEXT NOT NULL DEFAULT '',
        stop_reason           TEXT,
        input_tokens          INTEGER NOT NULL DEFAULT 0,
        output_tokens         INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        web_searches          INTEGER NOT NULL DEFAULT 0,
        duration_ms           INTEGER NOT NULL DEFAULT 0,
        created_at            INTEGER NOT NULL
      );

      CREATE INDEX idx_agents_project    ON agents(project_id);
      CREATE INDEX idx_tasks_project     ON tasks(project_id);
      CREATE INDEX idx_tasks_agent       ON tasks(assigned_agent_id);
      CREATE INDEX idx_tasks_status      ON tasks(status);
      CREATE INDEX idx_tasks_priority    ON tasks(priority);
      CREATE INDEX idx_tasks_building    ON tasks(building_key);
      CREATE INDEX idx_results_task      ON task_results(task_id);
    `,
  },
];
