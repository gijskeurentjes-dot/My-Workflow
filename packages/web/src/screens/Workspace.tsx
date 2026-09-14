import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BIOMES, PLOTS } from '@ai-islands/shared';
import { Avatar, ActivityFeed, ProgressBar, StatusPill, SimulatedNotice } from '../components/ui.js';
import { useTheme } from '../useTheme.js';
import { useWorld } from '../world/WorldProvider.js';
import { useAnimationClock, useSlowClock } from '../world/useAnimationClock.js';
import { botsForIsland, islandSummaries } from '../world/selectors.js';
import { IslandScene } from '../world/scene/IslandScene.js';

const CLOUDS = [
  { top: '6%', left: '4%', w: 150, h: 46, anim: 'floatA 42s ease-in-out infinite alternate' },
  { top: '13%', left: '58%', w: 190, h: 56, anim: 'floatB 52s ease-in-out infinite alternate' },
  { top: '66%', left: '2%', w: 120, h: 40, anim: 'floatB 46s ease-in-out infinite alternate' },
  { top: '74%', left: '70%', w: 160, h: 48, anim: 'floatA 58s ease-in-out infinite alternate' },
];

/**
 * The visual workspace.
 *
 * The islands on the left are the pleasant way to read the world. The rail on
 * the right carries exactly the same information as text, so nobody has to
 * interpret an animation to find out what is happening.
 */
export function Workspace() {
  const world = useWorld();
  const { theme } = useTheme();
  const clock = useAnimationClock();
  const slowClock = useSlowClock();
  const navigate = useNavigate();

  // Hovering a row in the rail highlights the matching agent card.
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const summaries = islandSummaries(world);

  return (
    <div className="workspace">
      <div className="canvas">
        <div className="canvas-scroll">
          {CLOUDS.map((c, i) => (
            <div
              key={i}
              className="cloud"
              style={{ top: c.top, left: c.left, width: c.w, height: c.h, animation: c.anim }}
            />
          ))}

          <div className="world-grid">
            {summaries.map((summary) => {
              const { island } = summary;
              const bots = botsForIsland(world, island.id, clock);
              const biome = BIOMES[island.biome];

              return (
                <button
                  key={island.id}
                  className="isle"
                  onClick={() => navigate(`/islands/${island.id}`)}
                  aria-label={`${island.name}. ${summary.state.label}. ${summary.bots.length} agents, ${summary.activeCount} working, ${summary.doneCount} delivered.`}
                >
                  <div className="isle-art">
                    <IslandScene island={island} bots={bots} clock={clock} theme={theme} mini />
                  </div>
                  <div className="isle-card">
                    <div className="isle-top">
                      <span className="isle-name">{island.name}</span>
                      <span
                        className="pill"
                        style={{
                          background: 'transparent',
                          color: `var(--${summary.state.tone})`,
                          border: '1px solid currentColor',
                        }}
                      >
                        <i style={{ background: 'currentColor' }} aria-hidden="true" />
                        {summary.state.label}
                      </span>
                    </div>
                    <p className="isle-blurb">{island.blurb}</p>
                    <div className="isle-meta">
                      <span>
                        <b>{summary.bots.length}</b> agents
                      </span>
                      <span>
                        <b>{summary.activeCount}</b> working
                      </span>
                      <span>
                        <b>{island.crates}</b> delivered
                      </span>
                      <span style={{ marginLeft: 'auto', color: biome.accent, fontWeight: 700 }}>
                        {biome.label}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="legend" aria-hidden="true">
          <div className="eyebrow">What the agents are doing</div>
          <div className="legend-row">
            <span className="legend-key" style={{ background: 'var(--ok)' }} />
            Working at the workbench
          </div>
          <div className="legend-row">
            <span className="legend-key" style={{ background: 'var(--warn)' }} />
            Waiting for your approval
          </div>
          <div className="legend-row">
            <span className="legend-key" style={{ background: 'var(--violet)' }} />
            Carrying work to the depot
          </div>
          <div className="legend-row">
            <span className="legend-key" style={{ background: 'var(--info)' }} />
            Paused, holding progress
          </div>
          <div className="legend-row">
            <span className="legend-key" style={{ background: 'var(--bad)' }} />
            Blocked, needs a decision
          </div>
        </div>
      </div>

      {/* The accessible twin of the world: everything above, as a list. */}
      <aside className="rail" aria-label="World summary">
        <div className="rail-pad">
          <h2 style={{ fontSize: 18 }}>Your AI world</h2>
          <p className="muted" style={{ marginTop: 4 }}>
            {world.islands.length} work areas, {world.bots.length} agents.
          </p>
        </div>

        <div className="rail-scroll">
          <div className="stat-grid" style={{ marginBottom: 14 }}>
            <div className="stat">
              <b>{world.stats.botsWorking}</b>
              <span>Working</span>
            </div>
            <div className={`stat${world.stats.approvalsPending ? ' attention' : ''}`}>
              <b>{world.stats.approvalsPending}</b>
              <span>Need you</span>
            </div>
            <div className="stat">
              <b>{world.stats.tasksOpen}</b>
              <span>Open tasks</span>
            </div>
            <div className="stat">
              <b>{world.stats.tasksCompleted}</b>
              <span>Delivered</span>
            </div>
          </div>

          <SimulatedNotice />

          <div className="card">
            <h4>The team right now</h4>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {world.bots.map((bot) => {
                const display = botsForIsland(world, bot.islandId, clock).find(
                  (d) => d.bot.id === bot.id,
                );
                if (!display) return null;
                const isSelected = selectedBotId === bot.id;

                return (
                  <li key={bot.id}>
                    <Link
                      to={`/bots/${bot.id}`}
                      className="bot-card"
                      style={isSelected ? { borderColor: 'var(--brand)' } : undefined}
                      onMouseEnter={() => setSelectedBotId(bot.id)}
                      onMouseLeave={() => setSelectedBotId(null)}
                    >
                      <div className="row">
                        <Avatar botKey={bot.key} size={34} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="bot-name">{bot.name}</div>
                          <div className="bot-role">{display.profile.title}</div>
                        </div>
                        <StatusPill status={bot.status} />
                      </div>
                      <div className="bot-line">{display.doing}</div>
                      <div className="bot-line" style={{ marginTop: 4, color: 'var(--ink-3)' }}>
                        {display.island.name} ·{' '}
                        {bot.movement
                          ? `walking to the ${PLOTS[bot.movement.toKey].label}`
                          : `at the ${PLOTS[bot.locationKey].label}`}
                      </div>
                      {display.task && display.task.status !== 'completed' && (
                        <ProgressBar
                          percent={display.task.progress}
                          tone={
                            bot.status === 'failed'
                              ? 'bad'
                              : bot.status === 'paused'
                                ? 'info'
                                : 'ok'
                          }
                        />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="card">
            <div className="between" style={{ marginBottom: 8 }}>
              <h4 style={{ margin: 0 }}>Recent activity</h4>
              <Link to="/activity" className="btn btn-ghost btn-sm">
                See all
              </Link>
            </div>
            <ActivityFeed events={world.activity.slice(0, 14)} now={slowClock} />
          </div>
        </div>
      </aside>
    </div>
  );
}
