import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BIOMES, PLOTS } from '@ai-islands/shared';
import { NewProjectDialog } from '../components/CreateDialogs.js';
import { ActivityFeed, Avatar, ProgressBar, SimulatedNotice, StatusPill } from '../components/ui.js';
import { useTheme } from '../useTheme.js';
import { useWorld } from '../world/WorldProvider.js';
import { useAnimationClock, useSlowClock } from '../world/useAnimationClock.js';
import { agentsForProject, projectSummaries } from '../world/selectors.js';
import { IslandScene } from '../world/scene/IslandScene.js';

const CLOUDS = [
  { top: '6%', left: '4%', w: 150, h: 46, anim: 'floatA 42s ease-in-out infinite alternate' },
  { top: '13%', left: '58%', w: 190, h: 56, anim: 'floatB 52s ease-in-out infinite alternate' },
  { top: '66%', left: '2%', w: 120, h: 40, anim: 'floatB 46s ease-in-out infinite alternate' },
  { top: '74%', left: '70%', w: 160, h: 48, anim: 'floatA 58s ease-in-out infinite alternate' },
];

/**
 * The visual workspace: one island per project.
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

  // Hovering a row in the rail highlights the matching agent.
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const summaries = projectSummaries(world);

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
              const { project } = summary;
              const agents = agentsForProject(world, project.id, clock);
              const biome = BIOMES[project.appearance.biome];

              return (
                <button
                  key={project.id}
                  className="isle"
                  onClick={() => navigate(`/projects/${project.id}`)}
                  aria-label={`${project.name}. ${summary.state.label}. ${summary.agents.length} agents, ${summary.activeCount} working, ${summary.doneCount} delivered.`}
                >
                  <div className="isle-art">
                    <IslandScene
                      project={project}
                      agents={agents}
                      tasks={summary.tasks}
                      clock={clock}
                      theme={theme}
                      selectedAgentId={hoveredAgentId}
                      mini
                    />
                  </div>
                  <div className="isle-card">
                    <div className="isle-top">
                      <span
                        className="project-swatch"
                        style={{ background: project.color, width: 10, height: 10 }}
                        aria-hidden="true"
                      />
                      <span className="isle-name">{project.name}</span>
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
                    <p className="isle-blurb">{project.description || 'No description yet.'}</p>
                    <div className="isle-meta">
                      <span>
                        <b>{summary.agents.length}</b> agents
                      </span>
                      <span>
                        <b>{summary.activeCount}</b> working
                      </span>
                      <span>
                        <b>{project.crates}</b> delivered
                      </span>
                      <span style={{ marginLeft: 'auto', color: biome.accent, fontWeight: 700 }}>
                        {biome.label}
                      </span>
                    </div>
                    <ProgressBar percent={summary.percent} />
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'grid', placeItems: 'center', paddingBottom: 36 }}>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              ＋ New project island
            </button>
          </div>
        </div>

        <div className="legend" aria-hidden="true">
          <div className="eyebrow">What the agents are doing</div>
          <div className="legend-row">
            <span className="legend-key" style={{ background: 'var(--ok)' }} />
            Working at a building
          </div>
          <div className="legend-row">
            <span className="legend-key" style={{ background: 'var(--warn)' }} />
            At headquarters, waiting for you
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
            {world.projects.length} project {world.projects.length === 1 ? 'island' : 'islands'},{' '}
            {world.agents.length} agents.
          </p>
        </div>

        <div className="rail-scroll">
          <div className="stat-grid" style={{ marginBottom: 14 }}>
            <div className="stat">
              <b>{world.stats.agentsWorking}</b>
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

          {summaries.map((summary) => {
            const displays = agentsForProject(world, summary.project.id, clock);
            if (displays.length === 0) return null;

            return (
              <div className="card" key={summary.project.id}>
                <div className="between" style={{ marginBottom: 8 }}>
                  <h4 style={{ margin: 0 }}>
                    <Link
                      to={`/projects/${summary.project.id}`}
                      style={{ textDecoration: 'none', color: 'inherit' }}
                    >
                      {summary.project.name}
                    </Link>
                  </h4>
                  <span className="count">{displays.length}</span>
                </div>

                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {displays.map((d) => (
                    <li key={d.agent.id}>
                      <Link
                        to={`/agents/${d.agent.id}`}
                        className="bot-card"
                        style={
                          hoveredAgentId === d.agent.id ? { borderColor: 'var(--brand)' } : undefined
                        }
                        onMouseEnter={() => setHoveredAgentId(d.agent.id)}
                        onMouseLeave={() => setHoveredAgentId(null)}
                      >
                        <div className="row">
                          <Avatar archetype={d.agent.archetype} size={34} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="bot-name">{d.agent.name}</div>
                            <div className="bot-role">{d.agent.role || d.profile.title}</div>
                          </div>
                          <StatusPill status={d.agent.status} />
                        </div>
                        <div className="bot-line">{d.doing}</div>
                        <div className="bot-line" style={{ marginTop: 4, color: 'var(--ink-3)' }}>
                          {d.agent.movement
                            ? `walking to the ${PLOTS[d.agent.movement.toKey].label}`
                            : `at the ${PLOTS[d.agent.currentLocation].label}`}
                        </div>
                        {d.task && d.task.status !== 'completed' && (
                          <ProgressBar
                            percent={d.task.progress}
                            tone={
                              d.agent.status === 'failed'
                                ? 'bad'
                                : d.agent.status === 'paused'
                                  ? 'info'
                                  : 'ok'
                            }
                          />
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

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

      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
