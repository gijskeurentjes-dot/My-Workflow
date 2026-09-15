import type { Id, ResearchReport, TaskResult, UsageSummary } from '@ai-islands/shared';
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

interface UsageRow {
  runs: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  web_searches: number;
  duration_ms: number;
  last_run_at: number | null;
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

  /**
   * Everything a set of runs cost, counted in SQL.
   *
   * Grouped in the database rather than in JavaScript because the alternative
   * is loading every report ever written — including the reports themselves —
   * to add up five integers.
   */
  const usageFor = (groupBy: 'agent_id' | 'task_id' | null) =>
    db.prepare(`
      SELECT ${groupBy ? `${groupBy} AS key,` : ''}
             COUNT(*)                        AS runs,
             COALESCE(SUM(input_tokens), 0)      AS input_tokens,
             COALESCE(SUM(output_tokens), 0)     AS output_tokens,
             COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
             COALESCE(SUM(web_searches), 0)      AS web_searches,
             COALESCE(SUM(duration_ms), 0)       AS duration_ms,
             MAX(created_at)                 AS last_run_at
      FROM task_results
      ${groupBy ? `GROUP BY ${groupBy}` : ''}
    `);

  const toUsage = (r: UsageRow): UsageSummary => ({
    runs: r.runs,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    webSearches: r.web_searches,
    durationMs: r.duration_ms,
    lastRunAt: r.last_run_at,
  });

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

    totalUsage: () => toUsage(usageFor(null).get() as UsageRow),

    usageByAgent: () =>
      (usageFor('agent_id').all() as (UsageRow & { key: string })[]).map((row) => ({
        agentId: row.key,
        usage: toUsage(row),
      })),

    usageByTask: () =>
      (usageFor('task_id').all() as (UsageRow & { key: string })[]).map((row) => ({
        taskId: row.key,
        usage: toUsage(row),
      })),

    findLatestByTask: (taskId: Id) => {
      const row = latest.get(taskId) as ResultRow | undefined;
      return row ? toResult(row) : null;
    },
  };
}
