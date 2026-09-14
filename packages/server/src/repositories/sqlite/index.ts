import type { Db } from '../../db/sqlite.js';
import type { Repositories } from '../types.js';
import { createActivityRepository } from './activity.repo.js';
import { createApprovalRepository } from './approvals.repo.js';
import { createAgentRepository } from './agents.repo.js';
import { createProjectRepository } from './projects.repo.js';
import { createTaskRepository } from './tasks.repo.js';

/**
 * The SQLite implementation of the persistence seam.
 *
 * A PostgreSQL build would export a `createPostgresRepositories` alongside this
 * with the same return type; nothing above the seam would notice the swap.
 */
export function createSqliteRepositories(db: Db): Repositories {
  return {
    agents: createAgentRepository(db),
    projects: createProjectRepository(db),
    tasks: createTaskRepository(db),
    approvals: createApprovalRepository(db),
    activity: createActivityRepository(db),

    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },

    reset(): void {
      // Order matters: children before parents, since foreign keys are on.
      db.transaction(() => {
        db.exec(`
          DELETE FROM activity_events;
          DELETE FROM approval_requests;
          DELETE FROM tasks;
          DELETE FROM agents;
          DELETE FROM projects;
        `);
      })();
    },
  };
}
