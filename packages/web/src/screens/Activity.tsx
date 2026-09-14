import { useMemo, useState } from 'react';
import { ActivityFeed, SimulatedNotice } from '../components/ui.js';
import { useWorld } from '../world/WorldProvider.js';
import { useSlowClock } from '../world/useAnimationClock.js';

/** The event log: everything that has happened, newest first. */
export function Activity() {
  const world = useWorld();
  const now = useSlowClock(5000);

  const [botId, setBotId] = useState('');
  const [projectId, setProjectId] = useState('');

  const events = useMemo(
    () =>
      world.activity.filter(
        (e) => (!botId || e.botId === botId) && (!projectId || e.projectId === projectId),
      ),
    [world.activity, botId, projectId],
  );

  return (
    <div className="page">
      <header className="page-head">
        <h1>Activity</h1>
        <p>
          Every assignment, start, pause, approval and delivery is recorded here, so nothing an
          agent does is invisible.
        </p>
      </header>

      <SimulatedNotice />

      <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <label className="row" style={{ gap: 6 }}>
          <span className="eyebrow">Agent</span>
          <select className="btn btn-sm" value={botId} onChange={(e) => setBotId(e.target.value)}>
            <option value="">All agents</option>
            {world.bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="row" style={{ gap: 6 }}>
          <span className="eyebrow">Project</span>
          <select
            className="btn btn-sm"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">All projects</option>
            {world.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <span className="chip" style={{ marginLeft: 'auto' }}>
          <i className="live-dot" aria-hidden="true" />
          Live
        </span>
      </div>

      <div className="card" style={{ maxWidth: 760 }}>
        <ActivityFeed events={events} now={now} />
      </div>
    </div>
  );
}
