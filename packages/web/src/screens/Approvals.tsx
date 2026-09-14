import { Link } from 'react-router-dom';
import { Avatar, EmptyState, StatusPill, timeAgo } from '../components/ui.js';
import { useWorld } from '../world/WorldProvider.js';
import { useSlowClock } from '../world/useAnimationClock.js';

/**
 * Work that is finished but not delivered, because an agent is waiting on you.
 *
 * Approving and rejecting are M2; this milestone shows the queue and where each
 * request came from.
 */
export function Approvals() {
  const world = useWorld();
  const now = useSlowClock();

  const pending = world.approvals.filter((a) => a.status === 'pending');
  const decided = world.approvals.filter((a) => a.status !== 'pending');

  const rowsFor = (ids: typeof pending) =>
    ids.map((approval) => {
      const task = world.tasks.find((t) => t.id === approval.taskId);
      const bot = world.bots.find((b) => b.id === approval.botId);
      const project = task ? world.projects.find((p) => p.id === task.projectId) : null;
      return { approval, task, bot, project };
    });

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
            {rowsFor(pending).map(({ approval, task, bot, project }) => (
              <article className="list-card" key={approval.id} style={{ cursor: 'default' }}>
                <div className="row" style={{ marginBottom: 8 }}>
                  {bot && <Avatar botKey={bot.key} size={34} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="bot-name">{task?.title ?? 'Unknown task'}</div>
                    <div className="bot-role">
                      {bot?.name ?? 'An agent'} · {timeAgo(approval.requestedAt, now)}
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
                  {bot && (
                    <Link to={`/bots/${bot.id}`} className="tag" style={{ textDecoration: 'none' }}>
                      View {bot.name}
                    </Link>
                  )}
                </div>

                <div className="banner" style={{ marginTop: 12, marginBottom: 0 }}>
                  <span aria-hidden="true">🔒</span>
                  <span>
                    Approve and reject arrive in the next milestone. Until then the request stays
                    here and the agent keeps holding the work.
                  </span>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {decided.length > 0 && (
        <>
          <h2 style={{ fontSize: 17, margin: '26px 0 12px' }}>Already decided</h2>
          <div className="card" style={{ maxWidth: 700 }}>
            {rowsFor(decided).map(({ approval, task }) => (
              <div className="kv" key={approval.id}>
                <span>{task?.title ?? 'Unknown task'}</span>
                <b>
                  {approval.status === 'approved' ? 'Approved' : 'Sent back'} ·{' '}
                  {approval.decidedAt ? timeAgo(approval.decidedAt, now) : ''}
                </b>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
