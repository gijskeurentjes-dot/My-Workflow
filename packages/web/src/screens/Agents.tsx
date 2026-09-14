import { Link } from 'react-router-dom';
import { PLOTS } from '@ai-islands/shared';
import { Avatar, EmptyState, ProgressBar, StatusPill } from '../components/ui.js';
import { useWorld } from '../world/WorldProvider.js';
import { useAnimationClock } from '../world/useAnimationClock.js';
import { allAgentDisplays } from '../world/selectors.js';

/** Every agent, grouped by the project they work on. */
export function Agents() {
  const world = useWorld();
  const clock = useAnimationClock();
  const displays = allAgentDisplays(world, clock);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Agents</h1>
        <p>
          Every project has its own team. An agent carries its own brief — the instructions a live
          engine would send as its system prompt — and the tools it is allowed to reach for.
        </p>
      </header>

      {displays.length === 0 && (
        <EmptyState
          icon="🤖"
          title="Nobody has been hired yet"
          body="Create a project and hire your first agent onto it."
        />
      )}

      {world.projects.map((project) => {
        const team = displays.filter((d) => d.project.id === project.id);
        if (team.length === 0) return null;

        return (
          <section key={project.id} style={{ marginBottom: 26 }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <span
                className="project-swatch"
                style={{ background: project.color, width: 11, height: 11 }}
                aria-hidden="true"
              />
              <h2 style={{ fontSize: 16 }}>
                <Link to={`/projects/${project.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  {project.name}
                </Link>
              </h2>
              <span className="count">{team.length}</span>
            </div>

            <div className="grid-cards">
              {team.map((d) => (
                <Link key={d.agent.id} to={`/agents/${d.agent.id}`} className="list-card">
                  <div className="row">
                    <Avatar archetype={d.agent.archetype} size={40} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="bot-name">{d.agent.name}</div>
                      <div className="bot-role">{d.agent.role || d.profile.title}</div>
                    </div>
                    <StatusPill status={d.agent.status} />
                  </div>

                  <div className="bot-line" style={{ color: 'var(--ink-2)' }}>
                    {d.doing}
                  </div>
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
                      note={d.task.title}
                    />
                  )}
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
