import type { ApprovalRequest, ApprovalStatus, Id } from '@ai-islands/shared';
import type { Db } from '../../db/sqlite.js';
import type { ApprovalRepository } from '../types.js';
import { toApproval, type ApprovalRow } from './rows.js';

export function createApprovalRepository(db: Db): ApprovalRepository {
  const selectAll = db.prepare('SELECT * FROM approval_requests ORDER BY requested_at DESC');
  const selectByStatus = db.prepare(
    'SELECT * FROM approval_requests WHERE status = ? ORDER BY requested_at DESC',
  );
  const selectById = db.prepare('SELECT * FROM approval_requests WHERE id = ?');
  const selectPendingByTask = db.prepare(
    "SELECT * FROM approval_requests WHERE task_id = ? AND status = 'pending' ORDER BY requested_at DESC LIMIT 1",
  );
  const insert = db.prepare(`
    INSERT INTO approval_requests (id, task_id, agent_id, summary, status, requested_at, decided_at, note)
    VALUES (@id, @task_id, @agent_id, @summary, @status, @requested_at, @decided_at, @note)
  `);
  const decideStmt = db.prepare(
    'UPDATE approval_requests SET status = ?, decided_at = ?, note = ? WHERE id = ?',
  );

  const read = (id: Id): ApprovalRequest | null => {
    const row = selectById.get(id) as ApprovalRow | undefined;
    return row ? toApproval(row) : null;
  };

  return {
    list: (filter?: { status?: ApprovalStatus }) => {
      const rows = (filter?.status ? selectByStatus.all(filter.status) : selectAll.all()) as ApprovalRow[];
      return rows.map(toApproval);
    },

    findById: read,

    findPendingByTask: (taskId: Id) => {
      const row = selectPendingByTask.get(taskId) as ApprovalRow | undefined;
      return row ? toApproval(row) : null;
    },

    create: (request: ApprovalRequest) => {
      insert.run({
        id: request.id,
        task_id: request.taskId,
        agent_id: request.agentId,
        summary: request.summary,
        status: request.status,
        requested_at: request.requestedAt,
        decided_at: request.decidedAt,
        note: request.note,
      });
      return request;
    },

    decide: (id, status, note) => {
      decideStmt.run(status, Date.now(), note, id);
      return read(id);
    },
  };
}
