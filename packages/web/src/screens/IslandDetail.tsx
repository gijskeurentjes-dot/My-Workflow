import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PLOTS, PLOT_KEYS, type PlotKey } from '@ai-islands/shared';
import { ActivityFeed, Avatar, EmptyState, ProgressBar, StatusPill } from '../components/ui.js';
import { useTheme } from '../useTheme.js';
import { useWorld } from '../world/WorldProvider.js';
import { useAnimationClock, useSlowClock } from '../world/useAnimationClock.js';
import { botsForIsland, toTaskDisplay } from '../world/selectors.js';
import { IslandScene } from '../world/scene/IslandScene.js';

/** One island, full size, with its agents and the work happening there. */
export function IslandDetail() {
  const { islandId = '' } = useParams();
  const world = useWorld();
  const { theme } = useTheme();
  const clock = useAnimationClock();
  const slowClock = useSlowClock();

  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [selectedPlot, setSelectedPlot] = useState<PlotKey | null>(null);

  const island = world.islands.find((i) => i.id === islandId);
  if (!island) {
    return (
      <div className="page">
        <EmptyState icon="🏝️" title="No such island" body="It may have been removed." />
        <Link to="/" className="btn">
          ← Back to the workspace
        </Link>
      </div>
    );
  }

  const bots = botsForIsland(world, island.id, clock);
  const tasks = world.tasks.filter((t) => t.islandId === island.id);
  const activity = world.activity.filter((e) => e.islandId === island.id);
  const openTasks = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');

  const plotInfo = selectedPlot ? PLOTS[selectedPlot] : null;
  const botsAtPlot = selectedPlot
    ? bots.filter((d) => (d.bot.movement ? d.bot.movement.toKey : d.bot.locationKey) === selectedPlot)
    : [];

  return (
    <div className="workspace">
      <div className="canvas">
        <IslandScene
          island={island}
          bots={bots}
          clock={clock}
          theme={theme}
          selectedBotId={selectedBotId}
          selectedPlot={selectedPlot}
          onSelectBot={setSelectedBotId}
          onSelectPlot={(key) => setSelectedPlot((cur) => (cur === key ? null : key))}
          onClearSelection={() => {
            setSelectedBotId(null);
            setSelectedPlot(null);
          }}
        />
      </div>

      <aside className="rail" aria-label={`${island.name} details`}>
        <div className="rail-pad">
          <Link to="/" className="btn btn-ghost btn-sm" style={{ marginLeft: -8, marginBottom: 6 }}>
            ← All islands
          </Link>
          <h2 style={{ fontSize: 19 }}>{island.name}</h2>
          <p className="muted" style={{ marginTop: 4 }}>
            {island.blurb}
          </p>
        </div>

        <div className="rail-scroll">
          <div className="stat-grid" style={{ marginBottom: 14 }}>
            <div className="stat">
              <b>{bots.length}</b>
              <span>Agents</span>
            </div>
            <div className="stat">
              <b>{openTasks.length}</b>
              <span>Open</span>
            </div>
            <div className="stat">
              <b>{island.crates}</b>
              <span>Delivered</span>
            </div>
          </div>

          {plotInfo && (
            <div className="card" style={{ borderColor: 'var(--brand)' }}>
              <div className="between" style={{ marginBottom: 6 }}>
                <h4 style={{ margin: 0 }}>
                  {plotInfo.icon} {plotInfo.label}
                </h4>
                <button className="btn btn-ghost btn-sm" onClick={() => setSelectedPlot(null)}>
                  Close
                </button>
              </div>
              <p className="muted">{plotInfo.purpose}</p>
              {botsAtPlot.length > 0 && (
                <div className="tags">
                  {botsAtPlot.map((d) => (
                    <span className="tag" key={d.bot.id}>
                      {d.profile.icon} {d.bot.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="card">
            <h4>Agents here</h4>
            {bots.length === 0 && <p className="muted">Nobody is on this island.</p>}
            {bots.map((d) => (
              <Link
                key={d.bot.id}
                to={`/bots/${d.bot.id}`}
                className="bot-card"
                onMouseEnter={() => setSelectedBotId(d.bot.id)}
                onMouseLeave={() => setSelectedBotId(null)}
              >
                <div className="row">
                  <Avatar botKey={d.bot.key} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="bot-name">{d.bot.name}</div>
                    <div className="bot-role">{d.profile.title}</div>
                  </div>
                  <StatusPill status={d.bot.status} />
                </div>
                <div className="bot-line">{d.doing}</div>
                {d.task && d.task.status !== 'completed' && (
                  <ProgressBar percent={d.task.progress} />
                )}
              </Link>
            ))}
          </div>

          <div className="card">
            <h4>
              Places on this island <span className="count">{PLOT_KEYS.length}</span>
            </h4>
            <p className="muted" style={{ marginBottom: 9 }}>
              Select one to see what happens there.
            </p>
            <div style={{ display: 'grid', gap: 6 }}>
              {PLOT_KEYS.map((key) => {
                const here = bots.filter(
                  (d) => (d.bot.movement ? d.bot.movement.toKey : d.bot.locationKey) === key,
                ).length;
                return (
                  <button
                    key={key}
                    className="btn btn-sm"
                    style={{ justifyContent: 'flex-start' }}
                    onClick={() => setSelectedPlot((cur) => (cur === key ? null : key))}
                  >
                    <span aria-hidden="true">{PLOTS[key].icon}</span>
                    {PLOTS[key].label}
                    {here > 0 && <span className="count" style={{ marginLeft: 'auto' }}>{here}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="card">
            <h4>
              Work here <span className="count">{openTasks.length}</span>
            </h4>
            {openTasks.length === 0 && <p className="muted">Nothing open on this island.</p>}
            {openTasks.map((task) => {
              const d = toTaskDisplay(world, task);
              return (
                <div className="task" key={task.id}>
                  <div className="between">
                    <span className="task-t">{task.title}</span>
                    <StatusPill status={task.status} />
                  </div>
                  <div className="tags">
                    {d.project && (
                      <span className="tag">
                        <span
                          className="project-swatch"
                          style={{ background: d.project.color }}
                          aria-hidden="true"
                        />
                        {d.project.name}
                      </span>
                    )}
                    <span className="tag">
                      {d.typeInfo.icon} {d.typeInfo.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card">
            <h4>Activity on this island</h4>
            <ActivityFeed events={activity.slice(0, 20)} now={slowClock} />
          </div>
        </div>
      </aside>
    </div>
  );
}
