import { useCallback, useEffect, useState } from 'react';
import type { Id, TaskResult } from '@ai-islands/shared';
import { api } from '../api/client.js';
import { useDomainEvents } from '../world/WorldProvider.js';
import { timeAgo } from './ui.js';

/**
 * What a real agent actually produced.
 *
 * Fetched rather than streamed: a report is far larger than anything else that
 * crosses the wire, and it is only worth reading once the work is finished. The
 * event stream says *when* to fetch it, which is what keeps the panel current
 * without polling.
 */
export function TaskResultPanel({ taskId, now }: { taskId: Id; now: number }) {
  const [results, setResults] = useState<TaskResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(() => {
    api
      .taskResults(taskId)
      .then((rows) => {
        setResults(rows);
        setError(null);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load the result'),
      );
  }, [taskId]);

  useEffect(load, [load]);

  // A finished run, a failure, or a fresh approval all mean there is something
  // new to read.
  useDomainEvents(['task.completed', 'task.failed', 'approval.requested'], (event) => {
    if ('taskId' in event && event.taskId === taskId) load();
  });

  if (error) {
    return (
      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        {error}
      </p>
    );
  }

  const latest = results?.[0];
  if (!latest) return null;

  const report = latest.report;

  return (
    <section className="result">
      <div className="between" style={{ marginBottom: 6 }}>
        <span className="eyebrow">What {latest.model} produced</span>
        <span className="muted" style={{ fontSize: 11 }}>
          {timeAgo(latest.createdAt, now)}
        </span>
      </div>

      <p className="result-summary">{latest.summary}</p>

      {report && (
        <>
          <div className="tags" style={{ marginTop: 8 }}>
            <span className="tag">confidence: {report.confidence}</span>
            <span className="tag">
              {report.findings.length} finding{report.findings.length === 1 ? '' : 's'}
            </span>
            <span className="tag">
              {report.sources.length} source{report.sources.length === 1 ? '' : 's'}
            </span>
          </div>

          {!expanded ? (
            <button className="btn btn-sm btn-ghost" onClick={() => setExpanded(true)}>
              Read the report
            </button>
          ) : (
            <div className="result-body">
              <h5>Findings</h5>
              <ul className="result-list">
                {report.findings.map((finding, i) => (
                  <li key={i}>
                    {/* Fact or assumption is the distinction the brief asks for,
                        so it is shown rather than flattened into prose. */}
                    <span className={`tag tone-${finding.kind === 'fact' ? 'ok' : 'warn'}`}>
                      {finding.kind}
                    </span>{' '}
                    {finding.statement}
                    {finding.sourceUrls.length > 0 && (
                      <span className="result-cites">
                        {finding.sourceUrls.map((url) => (
                          <a key={url} href={url} target="_blank" rel="noreferrer noopener">
                            source
                          </a>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              {report.sources.length > 0 && (
                <>
                  <h5>Sources it actually retrieved</h5>
                  <ul className="result-list">
                    {report.sources.map((source) => (
                      <li key={source.url}>
                        <a href={source.url} target="_blank" rel="noreferrer noopener">
                          {source.title || source.url}
                        </a>
                        {source.relevance && <div className="muted">{source.relevance}</div>}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {report.openQuestions.length > 0 && (
                <>
                  <h5>Still open</h5>
                  <ul className="result-list">
                    {report.openQuestions.map((question, i) => (
                      <li key={i}>{question}</li>
                    ))}
                  </ul>
                </>
              )}

              <button className="btn btn-sm btn-ghost" onClick={() => setExpanded(false)}>
                Collapse
              </button>
            </div>
          )}
        </>
      )}

      <div className="barnote" style={{ marginTop: 6 }}>
        <span className="mono">
          {latest.usage.inputTokens.toLocaleString()} in / {latest.usage.outputTokens.toLocaleString()} out
        </span>
        <span>
          {latest.usage.webSearches} search{latest.usage.webSearches === 1 ? '' : 'es'} ·{' '}
          {(latest.durationMs / 1000).toFixed(1)}s
          {results && results.length > 1 ? ` · attempt ${results.length}` : ''}
        </span>
      </div>
    </section>
  );
}
