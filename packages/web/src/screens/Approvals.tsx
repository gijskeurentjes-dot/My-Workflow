import { Link } from 'react-router-dom';
import { APPROVAL_CATEGORIES, type ApprovalRequest } from '@ai-islands/shared';
import { ApprovalCard, ApprovalOutcomeLine } from '../components/ApprovalCard.js';
import { EmptyState } from '../components/ui.js';
import { useWorld } from '../world/WorldProvider.js';
import { useSlowClock } from '../world/useAnimationClock.js';

/**
 * Everything waiting on a decision from you.
 *
 * Two kinds of thing end up here and they are not the same. Some agents have
 * **finished work** and need sign-off before it is delivered. Others are
 * **stopped mid-action**, asking before they do something with an effect —
 * sending, spending, deleting, deploying. The second kind is ordered first,
 * because a stopped agent is doing nothing at all until you answer.
 */
export function Approvals() {
  const world = useWorld();
  const now = useSlowClock();

  const pending = world.approvals.filter((a) => a.status === 'pending');
  const blocked = pending.filter((a) => a.blocking);
  const deliverables = pending.filter((a) => !a.blocking);
  const decided = world.approvals.filter((a) => a.status !== 'pending').slice(0, 14);

  const titleOf = (approval: ApprovalRequest) =>
    world.tasks.find((t) => t.id === approval.taskId)?.title ?? approval.action;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Approvals</h1>
        <p>
          No agent sends, spends, deletes, deploys or delivers on its own. Anything with an effect
          stops here first, and the agent waits — actually waits — until you answer.
        </p>
      </header>

      {pending.length === 0 ? (
        <EmptyState
          icon="✅"
          title="Nothing is waiting on you"
          body="When an agent needs permission, or finishes work that needs sign-off, it appears here."
        />
      ) : (
        <>
          {blocked.length > 0 && (
            <>
              <div className="banner attention">
                <span aria-hidden="true">⏸</span>
                <span>
                  {blocked.length} {blocked.length === 1 ? 'agent is' : 'agents are'} stopped
                  mid-task, waiting for permission. Nothing is happening until you answer.
                </span>
              </div>
              <div className="grid-asks">
                {blocked.map((approval) => (
                  <ApprovalCard key={approval.id} world={world} approval={approval} now={now} />
                ))}
              </div>
            </>
          )}

          {deliverables.length > 0 && (
            <>
              <h2 style={{ fontSize: 17, margin: blocked.length ? '26px 0 12px' : '0 0 12px' }}>
                Finished work, waiting for sign-off
              </h2>
              <div className="grid-asks">
                {deliverables.map((approval) => (
                  <ApprovalCard key={approval.id} world={world} approval={approval} now={now} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {decided.length > 0 && (
        <>
          <h2 style={{ fontSize: 17, margin: '26px 0 12px' }}>Already decided</h2>
          <p className="muted" style={{ marginTop: -6, maxWidth: 700 }}>
            The record of what you allowed and what you did not. Every decision is also in the{' '}
            <Link to="/activity">activity log</Link>, with the reason attached.
          </p>
          <div className="card" style={{ maxWidth: 700 }}>
            {decided.map((approval) => (
              <ApprovalOutcomeLine
                key={approval.id}
                approval={approval}
                title={titleOf(approval)}
                now={now}
              />
            ))}
          </div>
        </>
      )}

      <h2 style={{ fontSize: 17, margin: '26px 0 12px' }}>What always needs your permission</h2>
      <div className="card" style={{ maxWidth: 700 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          These are enforced on the server, not asked for in an agent’s instructions. An agent
          cannot do any of them without a yes from you.
        </p>
        <ul className="rule-list">
          {Object.values(APPROVAL_CATEGORIES)
            .filter((c) => c.key !== 'deliverable')
            .map((category) => (
              <li key={category.key}>
                <b>
                  {category.icon} {category.label}
                </b>{' '}
                — {category.description}
                {!category.reversible && (
                  <span className="muted"> Cannot be undone.</span>
                )}
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}
