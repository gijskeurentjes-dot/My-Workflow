import { Link, useParams } from 'react-router-dom';
import { TASK_STATUSES, type TaskStatus } from '@ai-islands/shared';
import { ActivityFeed, Avatar, EmptyState, ProgressBar, StatusPill } from '../components/ui.js';
import { useWorld } from '../world/WorldProvider.js';
import { useSlowClock } from '../world/useAnimationClock.js';
import { toTaskDisplay } from '../world/selectors.js';

/** Order the board reads in: what needs you first, finished work last. */
const COLUMN_ORDER: TaskStatus[] = [
  'waiting_approval',
  'failed',
  'working',
  'delivering',
  'paused',
  'backlog',
  'completed',
  'cancelled',
];

const COLUMN_LABEL: Record<TaskStatus, string> = {
  waiting_approval: 'Waiting for approval',
  failed: 'Blocked',
  working: 'In progress',
  delivering: 'Delivering',
  paused: 'Paused',
  backlog: 'On the board',
  completed: 'Delivered',
  cancelled: 'Cancelled',
};

export function ProjectDetail() {
  const { projectId = '' } = useParams();
  const world = useWorld();
  const now = useSlowClock();

  const project = world.projects.find((p) => p.id === projectId);
  if (!project) {
    return (
      <div className="page">
        <EmptyState icon="🗂️" title="No such project" />
        <Link to="/projects" className="btn">
          ← Back to projects
        </Link>
      </div>
    );
  }

  const tasks = world.tasks.filter((t) => t.projectId === project.id);
  const done = tasks.filter((t) => t.status === 'completed').length;
  const percent = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const activity = world.activity.filter((e) => e.projectId === project.id);

  return (
    <div className="page">
      <header className="page-head">
        <Link to="/projects" className="btn btn-ghost btn-sm" style={{ marginLeft: -10 }}>
          ← Projects
        </Link>
        <div className="row" style={{ marginTop: 8 }}>
          <span
            className="project-swatch"
            style={{ background: project.color, width: 14, height: 14 }}
            aria-hidden="true"
          />
          <h1>{project.name}</h1>
          <StatusPill status={project.status === 'active' ? 'working' : 'paused'} />
        </div>
        <p>{project.goal}</p>
      </header>

      <div className="card" style={{ maxWidth: 520 }}>
        <h4>Progress</h4>
        <ProgressBar percent={percent} note={`${done} of ${tasks.length} tasks delivered`} />
      </div>

      <h2 style={{ fontSize: 17, margin: '22px 0 12px' }}>Tasks</h2>
      {tasks.length === 0 ? (
        <EmptyState icon="📋" title="No tasks in this project yet" />
      ) : (
        <div className="board">
          {COLUMN_ORDER.filter((status) => tasks.some((t) => t.status === status)).map((status) => {
            const column = tasks.filter((t) => t.status === status);
            return (
              <section className="board-col" key={status}>
                <div className="col-head">
                  <span className="eyebrow">{COLUMN_LABEL[status]}</span>
                  <span className="count">{column.length}</span>
                </div>
                {column.map((task) => {
                  const d = toTaskDisplay(world, task);
                  return (
                    <article className="task" key={task.id}>
                      <div className="task-t">{task.title}</div>
                      {task.notes && <div className="task-n">{task.notes}</div>}
                      {task.blocker && (
                        <div
                          className="task-n"
                          style={{ color: 'var(--bad)', fontWeight: 600, marginTop: 6 }}
                        >
                          ⚠ {task.blocker}
                        </div>
                      )}
                      <div className="tags">
                        <span className="tag">
                          {d.typeInfo.icon} {d.typeInfo.label}
                        </span>
                        {d.island && <span className="tag">{d.island.name}</span>}
                        {d.bot ? (
                          <Link to={`/bots/${d.bot.id}`} className="tag" style={{ textDecoration: 'none' }}>
                            <Avatar botKey={d.bot.key} size={14} />
                            {d.bot.name}
                          </Link>
                        ) : (
                          <span className="tag" style={{ color: 'var(--ink-3)' }}>
                            Unassigned
                          </span>
                        )}
                      </div>
                      {(task.status === 'working' ||
                        task.status === 'paused' ||
                        task.status === 'failed') && (
                        <ProgressBar
                          percent={task.progress}
                          tone={
                            task.status === 'failed' ? 'bad' : task.status === 'paused' ? 'info' : 'ok'
                          }
                          note={
                            task.status === 'paused'
                              ? 'paused — progress held'
                              : task.status === 'failed'
                                ? 'blocked'
                                : 'simulated progress'
                          }
                        />
                      )}
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}

      <h2 style={{ fontSize: 17, margin: '26px 0 12px' }}>Activity</h2>
      <div className="card" style={{ maxWidth: 680 }}>
        <ActivityFeed events={activity.slice(0, 25)} now={now} />
      </div>
    </div>
  );
}

export const ALL_TASK_STATUSES = TASK_STATUSES;
