import { Link, useParams } from 'react-router-dom';
import { MOVEMENT_LABEL, PLOTS, STATUS_LABEL } from '@ai-islands/shared';
import {
  ActivityFeed,
  Avatar,
  EmptyState,
  ProgressBar,
  SimulatedNotice,
  StatusPill,
} from '../components/ui.js';
import { AgentBrief } from '../components/AgentBrief.js';
import { TaskCard } from '../components/TaskCard.js';
import { useWorld } from '../world/WorldProvider.js';
import { useAnimationClock, useSlowClock } from '../world/useAnimationClock.js';
import { toBotDisplay, toTaskDisplay } from '../world/selectors.js';

/**
 * One agent in full.
 *
 * The responsibilities, tools and approval rules shown here are the same data a
 * real agent engine would turn into a system prompt — they are not decoration.
 */
export function BotDetail() {
  const { botId = '' } = useParams();
  const world = useWorld();
  const clock = useAnimationClock();
  const now = useSlowClock();

  const bot = world.bots.find((b) => b.id === botId);
  const display = bot ? toBotDisplay(world, bot, clock) : null;

  if (!bot || !display) {
    return (
      <div className="page">
        <EmptyState icon="🤖" title="No such agent" />
        <Link to="/bots" className="btn">
          ← Back to the team
        </Link>
      </div>
    );
  }

  const { profile, task, island, project } = display;
  const activity = world.activity.filter((e) => e.botId === bot.id);
  const history = world.tasks.filter((t) => t.botId === bot.id);

  return (
    <div className="page">
      <header className="page-head">
        <Link to="/bots" className="btn btn-ghost btn-sm" style={{ marginLeft: -10 }}>
          ← The team
        </Link>
        <div className="row" style={{ marginTop: 10, alignItems: 'flex-start' }}>
          <Avatar botKey={bot.key} size={52} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 22 }}>{bot.name}</h1>
            <p style={{ margin: '2px 0 0', color: 'var(--ink-3)', fontWeight: 600, fontSize: 13 }}>
              {bot.role || profile.title}
            </p>
          </div>
          <StatusPill status={bot.status} />
        </div>
        <p>{profile.tagline}</p>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <div>
          <div className="card">
            <div className="between" style={{ marginBottom: 9 }}>
              <h4 style={{ margin: 0 }}>Right now</h4>
              <SimulatedNotice compact />
            </div>
            <div className="kv">
              <span>Status</span>
              <b>{STATUS_LABEL[bot.status]}</b>
            </div>
            <div className="kv">
              <span>Doing</span>
              <b>{display.doing}</b>
            </div>
            <div className="kv">
              <span>Island</span>
              <b>
                <Link to={`/islands/${island.id}`}>{island.name}</Link>
              </b>
            </div>
            <div className="kv">
              <span>Location</span>
              <b>
                {PLOTS[bot.locationKey].icon} {PLOTS[bot.locationKey].label}
              </b>
            </div>
            <div className="kv">
              <span>Movement</span>
              <b>
                {MOVEMENT_LABEL[display.movement]}
                {bot.movement ? ` → ${PLOTS[bot.movement.toKey].label}` : ''}
              </b>
            </div>
            <div className="kv">
              <span>Current task</span>
              <b>{task ? task.title : 'None'}</b>
            </div>
            {project && (
              <div className="kv">
                <span>Project</span>
                <b>
                  <Link to={`/projects/${project.id}`}>{project.name}</Link>
                </b>
              </div>
            )}
            {task && task.status !== 'completed' && (
              <div style={{ marginTop: 10 }}>
                <ProgressBar
                  percent={task.progress}
                  tone={bot.status === 'failed' ? 'bad' : bot.status === 'paused' ? 'info' : 'ok'}
                  note="simulated progress"
                />
              </div>
            )}
          </div>

          {/* Drive the work this agent is holding, without leaving the page. */}
          {task && (
            <div className="card">
              <h4>Current task</h4>
              <TaskCard world={world} task={task} now={now} showIsland />
            </div>
          )}

          <AgentBrief bot={bot} />
        </div>

        <div>
          <div className="card">
            <h4>
              Work history <span className="count">{history.length}</span>
            </h4>
            {history.length === 0 && <p className="muted">Nothing assigned yet.</p>}
            {history.map((t) => {
              const d = toTaskDisplay(world, t);
              return (
                <div className="task" key={t.id}>
                  <div className="between">
                    <span className="task-t">{t.title}</span>
                    <StatusPill status={t.status} />
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
            <h4>Activity</h4>
            <ActivityFeed
              events={activity.slice(0, 30)}
              now={now}
              emptyBody={`${bot.name} has not done anything yet.`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
