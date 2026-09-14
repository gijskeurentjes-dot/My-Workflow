import type { Id, ResearchReport, TaskResult } from '@ai-islands/shared';
import type { Db } from '../../db/sqlite.js';
import type { TaskResultRepository } from '../types.js';

interface ResultRow {
  id: string;
  task_id: string;
  agent_id: string;
  summary: string;
  report: string | null;
  raw_text: string;
  model: string;
  stop_reason: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  web_searches: number;
  duration_ms: number;
  created_at: number;
}

/** A stored report that will not parse must not break reading the rest. */
function parseReport(raw: string | null): ResearchReport | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ResearchReport;
  } catch {
    return null;
  }
}

const toResult = (r: ResultRow): TaskResult => ({
  id: r.id,
  taskId: r.task_id,
  agentId: r.agent_id,
  summary: r.summary,
  report: parseReport(r.report),
  rawText: r.raw_text,
  model: r.model,
  stopReason: r.stop_reason,
  usage: {
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheCreationTokens: r.cache_creation_tokens,
    webSearches: r.web_searches,
  },
  durationMs: r.duration_ms,
  createdAt: r.created_at,
});

export function createTaskResultRepository(db: Db): TaskResultRepository {
  const insert = db.prepare(`
    INSERT INTO task_results (id, task_id, agent_id, summary, report, raw_text, model, stop_reason,
                              input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                              web_searches, duration_ms, created_at)
    VALUES (@id, @task_id, @agent_id, @summary, @report, @raw_text, @model, @stop_reason,
            @input_tokens, @output_tokens, @cache_read_tokens, @cache_creation_tokens,
            @web_searches, @duration_ms, @created_at)
  `);
  const byTask = db.prepare(
    'SELECT * FROM task_results WHERE task_id = ? ORDER BY created_at DESC, rowid DESC',
  );
  const latest = db.prepare(
    'SELECT * FROM task_results WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
  );

  return {
    create: (result: TaskResult) => {
      insert.run({
        id: result.id,
        task_id: result.taskId,
        agent_id: result.agentId,
        summary: result.summary,
        report: result.report ? JSON.stringify(result.report) : null,
        raw_text: result.rawText,
        model: result.model,
        stop_reason: result.stopReason,
        // A counter the API did not report is zero, not a NOT NULL violation
        // that would surface to a reader as the blocker on their task.
        input_tokens: result.usage.inputTokens ?? 0,
        output_tokens: result.usage.outputTokens ?? 0,
        cache_read_tokens: result.usage.cacheReadTokens ?? 0,
        cache_creation_tokens: result.usage.cacheCreationTokens ?? 0,
        web_searches: result.usage.webSearches ?? 0,
        duration_ms: result.durationMs,
        created_at: result.createdAt,
      });
      return result;
    },

    listByTask: (taskId: Id) => (byTask.all(taskId) as ResultRow[]).map(toResult),

    findLatestByTask: (taskId: Id) => {
      const row = latest.get(taskId) as ResultRow | undefined;
      return row ? toResult(row) : null;
    },
  };
}
