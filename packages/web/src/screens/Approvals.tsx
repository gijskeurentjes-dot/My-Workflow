import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { Avatar, EmptyState, StatusPill, timeAgo } from '../components/ui.js';
import { useCommands } from '../world/CommandProvider.js';
import { useWorld } from '../world/WorldProvider.js';
import { useSlowClock } from '../world/useAnimationClock.js';

/**
 * Work that is finished but not delivered, because an agent is waiting on you.
 *
 * Approving sends it to the depot; sending it back reopens the work with your
 * note attached, and the agent carries on from where it was.
 */
export function Approvals() {
  const world = useWorld();
  const now = useSlowClock();
  const { run, isPending } = useCommands();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const pending = world.approvals.filter((a) => a.status === 'pending');
  const decided = world.approvals.filter((a) => a.status !== 'pending').slice(0, 12);

  const join = (approval: (typeof world.approvals)[number]) => {
    const task = world.tasks.find((t) => t.id === approval.taskId);
    const agent = world.agents.find((b) => b.id === approval.agentId);
    const project = task ? world.projects.find((p) => p.id === task.projectId) : null;
    return { task, agent, project };
  };

  const sendBack = async (approvalId: string) => {
    const ok = await run(
      `reject:${approvalId}`,
      () => api.reject(approvalId, note),
      'Sent back for changes',
    );
    if (ok) {
      setRejectingId(null);
      setNote('');
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Approval queue</h1>
        <p>
          An agent never delivers work that needs sign-off on its own. Finished work waits at the
          Approval Post on its island until you decide.
        </p>
      </header>

      {pending.length === 0 ? (
        <EmptyState
          icon="✅"
          title="Nothing is waiting on you"
          body="When an agent finishes work that needs approval, it appears here."
        />
      ) : (
        <>
          <div className="banner attention">
            <span aria-hidden="true">✋</span>
            <span>
              {pending.length} {pending.length === 1 ? 'agent is' : 'agents are'} standing at the
              Approval Post, holding finished work.
            </span>
          </div>

          <div className="grid-cards">
            {pending.map((approval) => {
              const { task, agent, project } = join(approval);
              const busy =
                isPending(`approve:${approval.id}`) || isPending(`reject:${approval.id}`);

              return (
                <article className="list-card" key={approval.id} style={{ cursor: 'default' }}>
                  <div className="row" style={{ marginBottom: 8 }}>
                    {agent && <Avatar archetype={agent.archetype} size={34} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="bot-name">{task?.title ?? 'Unknown task'}</div>
                      <div className="bot-role">
                        {agent?.name ?? 'An agent'} · {timeAgo(approval.requestedAt, now)}
                      </div>
                    </div>
                    <StatusPill status="waiting_approval" />
                  </div>

                  <p className="muted">{approval.summary}</p>

                  <div className="tags">
                    {project && (
                      <Link
                        to={`/projects/${project.id}`}
                        className="tag"
                        style={{ textDecoration: 'none' }}
                      >
                        <span
                          className="project-swatch"
                          style={{ background: project.color }}
                          aria-hidden="true"
                        />
                        {project.name}
                      </Link>
                    )}
                    {agent && (
                      <Link
                        to={`/agents/${agent.id}`}
                        className="tag"
                        style={{ textDecoration: 'none' }}
                      >
                        View {agent.name}
                      </Link>
                    )}
                  </div>

                  {rejectingId === approval.id ? (
                    <div style={{ marginTop: 12 }}>
                      <div className="label">What needs changing?</div>
                      <textarea
                        className="input"
                        rows={2}
                        value={note}
                        maxLength={500}
                        autoFocus
                        placeholder="Optional — the note is written to the activity log."
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <div className="acts">
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={busy}
                          onClick={() => sendBack(approval.id)}
                        >
                          ↩ Send it back
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => {
                            setRejectingId(null);
                            setNote('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="acts" style={{ marginTop: 12 }}>
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={busy}
                        onClick={() =>
                          run(
                            `approve:${approval.id}`,
                            () => api.approve(approval.id),
                            `Approved — ${agent?.name ?? 'the agent'} is delivering it`,
                          )
                        }
                      >
                        ✓ Approve and deliver
                      </button>
                      <button
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={() => {
                          setRejectingId(approval.id);
                          setNote('');
                        }}
                      >
                        ↩ Request changes
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}

      {decided.length > 0 && (
        <>
          <h2 style={{ fontSize: 17, margin: '26px 0 12px' }}>Already decided</h2>
          <div className="card" style={{ maxWidth: 700 }}>
            {decided.map((approval) => {
              const { task } = join(approval);
              return (
                <div className="kv" key={approval.id}>
                  <span>
                    {task?.title ?? 'Unknown task'}
                    {approval.note && (
                      <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>
                        “{approval.note}”
                      </span>
                    )}
                  </span>
                  <b>
                    {approval.status === 'approved' ? 'Approved' : 'Sent back'}
                    {approval.decidedAt ? ` · ${timeAgo(approval.decidedAt, now)}` : ''}
                  </b>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
