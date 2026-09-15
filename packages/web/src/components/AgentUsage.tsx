import { useEffect, useState } from 'react';
import type { Id, ProjectFile, UsageReport, UsageSummary } from '@ai-islands/shared';
import { api } from '../api/client.js';
import { useDomainEvents } from '../world/WorldProvider.js';
import { timeAgo } from './ui.js';

/**
 * What this agent produced, and what its real runs cost.
 *
 * Only live runs appear in the numbers — the simulation costs nothing, and a
 * figure that quietly mixed the two would be worse than none. An agent that has
 * never run for real says so, rather than showing a row of confident zeroes.
 */
export function AgentUsage({
  agentId,
  produced,
  now,
}: {
  agentId: Id;
  produced: ProjectFile[];
  now: number;
}) {
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  const load = () => {
    api
      .usage()
      .then((report: UsageReport) => {
        setUsage(report.byAgent.find((row) => row.agentId === agentId)?.usage ?? null);
      })
      .catch(() => setUsage(null));
  };

  useEffect(load, [agentId]);
  // A finished run changes these numbers, so they are refetched when one lands
  // rather than going stale until the page is reopened.
  useDomainEvents(['task.completed', 'task.failed'], load);

  if (produced.length === 0 && (!usage || usage.runs === 0)) return null;

  return (
    <section className="card">
      <h4>What it produced</h4>

      {produced.length === 0 ? (
        <p className="muted" style={{ marginTop: 0 }}>
          Nothing recorded as a deliverable yet.
        </p>
      ) : (
        <ul className="rule-list">
          {produced.slice(0, 8).map((file) => (
            <li key={file.id}>
              📎{' '}
              {file.location ? (
                <a href={file.location} target="_blank" rel="noreferrer noopener">
                  {file.name}
                </a>
              ) : (
                file.name
              )}
              <span className="muted"> · {timeAgo(file.createdAt, now)}</span>
            </li>
          ))}
        </ul>
      )}

      {usage && usage.runs > 0 && (
        <>
          <div className="kv" style={{ marginTop: 10 }}>
            <span>Live runs</span>
            <b>{usage.runs}</b>
          </div>
          <div className="kv">
            <span>Tokens</span>
            <b className="mono">
              {usage.inputTokens.toLocaleString()} in / {usage.outputTokens.toLocaleString()} out
            </b>
          </div>
          <div className="kv">
            <span>Web searches</span>
            <b className="mono">{usage.webSearches}</b>
          </div>
          <div className="kv">
            <span>Model time</span>
            <b className="mono">{(usage.durationMs / 1000).toFixed(1)}s</b>
          </div>
          {usage.lastRunAt && (
            <div className="kv">
              <span>Last run</span>
              <b>{timeAgo(usage.lastRunAt, now)}</b>
            </div>
          )}
        </>
      )}
    </section>
  );
}
