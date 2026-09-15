import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  APPROVAL_CATEGORIES,
  ARCHETYPES,
  RISK_LABEL,
  RISK_TONE,
  type ApprovalRequest,
  type WorldSnapshot,
} from '@ai-islands/shared';
import { api } from '../api/client.js';
import { useCommands } from '../world/CommandProvider.js';
import { Avatar, timeAgo } from './ui.js';

/**
 * One agent, asking permission.
 *
 * Everything needed to answer is on the card: who is asking, on what, what they
 * propose to do, why, with which tools, what it would touch, and what happens
 * if it is wrong. A request you have to go and investigate before you can
 * answer is a request that gets waved through, which is the failure mode this
 * whole system exists to avoid.
 *
 * Three answers, and they are genuinely different:
 * **Approve** lets it happen; **Reject** refuses the action and the agent
 * carries on without it; **Cancel** calls the work off entirely.
 */
export function ApprovalCard({
  world,
  approval,
  now,
  compact = false,
}: {
  world: WorldSnapshot;
  approval: ApprovalRequest;
  now: number;
  /** Inside an agent's page, where the agent is already obvious. */
  compact?: boolean;
}) {
  const { run, isPending } = useCommands();
  const [mode, setMode] = useState<'idle' | 'reject' | 'cancel'>('idle');
  const [note, setNote] = useState('');

  const task = world.tasks.find((t) => t.id === approval.taskId);
  const agent = world.agents.find((a) => a.id === approval.agentId);
  const project = world.projects.find((p) => p.id === (task?.projectId ?? agent?.projectId));
  const category = APPROVAL_CATEGORIES[approval.category];
  // "Send back" is what you do to finished work; everything else you refuse.
  // The word follows what the request *is*, not whether a run happens to be
  // stopped on it, so the same kind of ask always reads the same way.
  const isDeliverable = approval.category === 'deliverable';

  const busy =
    isPending(`approve:${approval.id}`) ||
    isPending(`reject:${approval.id}`) ||
    isPending(`cancel:${approval.id}`);

  const close = () => {
    setMode('idle');
    setNote('');
  };

  const decide = async (
    kind: 'approve' | 'reject' | 'cancel',
    call: () => Promise<unknown>,
    message: string,
  ) => {
    const ok = await run(`${kind}:${approval.id}`, call, message);
    if (ok) close();
  };

  return (
    <article className="approval">
      <div className="row" style={{ marginBottom: 8 }}>
        {agent && !compact && <Avatar archetype={agent.archetype} size={34} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="bot-name">{approval.action}</div>
          <div className="bot-role">
            {agent ? (
              <>
                {agent.name} · {agent.role || ARCHETYPES[agent.archetype].title}
              </>
            ) : (
              'An agent'
            )}{' '}
            · asked {timeAgo(approval.requestedAt, now)}
          </div>
        </div>
        <span className={`pill tone-${RISK_TONE[approval.risk]}`} title={category.description}>
          <i aria-hidden="true" />
          {RISK_LABEL[approval.risk]}
        </span>
      </div>

      <div className="tags">
        <span className="tag" title={category.description}>
          {category.icon} {category.label}
        </span>
        {approval.blocking && (
          <span className="tag" title="The agent is stopped, waiting for this answer.">
            ⏸ the run is stopped
          </span>
        )}
        {project && (
          <Link to={`/projects/${project.id}`} className="tag" style={{ textDecoration: 'none' }}>
            <span
              className="project-swatch"
              style={{ background: project.color }}
              aria-hidden="true"
            />
            {project.name}
          </Link>
        )}
        {task && (
          <span className="tag" title="The task this belongs to">
            📋 {task.title}
          </span>
        )}
      </div>

      <dl className="ask">
        {approval.reason && (
          <>
            <dt>Why</dt>
            <dd>{approval.reason}</dd>
          </>
        )}
        <dt>If this is wrong</dt>
        <dd>{approval.impact}</dd>
        {approval.tools.length > 0 && (
          <>
            <dt>Tools</dt>
            <dd>{approval.tools.join(', ')}</dd>
          </>
        )}
        {approval.files.length > 0 && (
          <>
            <dt>Touches</dt>
            <dd className="mono">{approval.files.join(', ')}</dd>
          </>
        )}
      </dl>

      {mode === 'idle' ? (
        <div className="acts" style={{ marginTop: 12 }}>
          <button
            className="btn btn-sm btn-primary"
            disabled={busy}
            onClick={() =>
              decide(
                'approve',
                () => api.approve(approval.id),
                approval.blocking
                  ? `Approved — ${agent?.name ?? 'the agent'} is carrying on`
                  : `Approved — ${agent?.name ?? 'the agent'} is delivering it`,
              )
            }
          >
            ✓ Approve
          </button>
          <button className="btn btn-sm" disabled={busy} onClick={() => setMode('reject')}>
            {isDeliverable ? '↩ Send back' : '✕ Reject'}
          </button>
          <button
            className="btn btn-sm btn-bad"
            disabled={busy}
            title="Withdraw the request and stop this work."
            onClick={() => setMode('cancel')}
          >
            ⏹ Cancel the task
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div className="label">
            {mode === 'reject'
              ? isDeliverable
                ? 'What needs changing?'
                : 'Why not? The agent is told, and it goes in the log.'
              : 'Cancelling stops this work. Why?'}
          </div>
          <textarea
            className="input"
            rows={2}
            value={note}
            maxLength={500}
            autoFocus
            placeholder="Optional — written to the activity log."
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="acts">
            <button
              className={`btn btn-sm ${mode === 'cancel' ? 'btn-bad' : 'btn-primary'}`}
              disabled={busy}
              onClick={() =>
                mode === 'reject'
                  ? decide(
                      'reject',
                      () => api.reject(approval.id, note),
                      isDeliverable ? 'Sent back for changes' : 'Refused — it will not happen',
                    )
                  : decide(
                      'cancel',
                      () => api.cancelApproval(approval.id, note),
                      'Cancelled — the work stops here',
                    )
              }
            >
              {mode === 'reject'
                ? isDeliverable
                  ? '↩ Send it back'
                  : '✕ Refuse this action'
                : '⏹ Cancel the task'}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={close}>
              Back
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

/** What was decided, for the record. */
export function ApprovalOutcomeLine({
  approval,
  title,
  now,
}: {
  approval: ApprovalRequest;
  title: string;
  now: number;
}) {
  const word =
    approval.status === 'approved'
      ? 'Approved'
      : approval.status === 'rejected'
        ? 'Refused'
        : 'Withdrawn';

  return (
    <div className="kv">
      <span>
        {title}
        <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>
          {APPROVAL_CATEGORIES[approval.category].label}
          {approval.note ? ` · “${approval.note}”` : ''}
        </span>
      </span>
      <b>
        {word}
        {approval.decidedAt ? ` · ${timeAgo(approval.decidedAt, now)}` : ''}
      </b>
    </div>
  );
}
