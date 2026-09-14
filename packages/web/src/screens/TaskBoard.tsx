import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TASK_TYPES, type TaskStatus } from '@ai-islands/shared';
import { Avatar, EmptyState, ProgressBar, StatusPill } from '../components/ui.js';
import { useWorld } from '../world/WorldProvider.js';
import { toTaskDisplay } from '../world/selectors.js';

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'waiting_approval', label: 'Waiting for approval' },
  { status: 'failed', label: 'Blocked' },
  { status: 'working', label: 'In progress' },
  { status: 'delivering', label: 'Delivering' },
  { status: 'paused', label: 'Paused' },
  { status: 'backlog', label: 'On the board' },
  { status: 'completed', label: 'Delivered' },
];

/** Every task across every project, grouped by what state it is in. */
export function TaskBoard() {
  const world = useWorld();
  const [projectId, setProjectId] = useState('');
  const [islandId, setIslandId] = useState('');

  const tasks = useMemo(
    () =>
      world.tasks.filter(
        (t) => (!projectId || t.projectId === projectId) && (!islandId || t.islandId === islandId),
      ),
    [world.tasks, projectId, islandId],
  );

  return (
    <div className="page">
      <header className="page-head">
        <h1>Task board</h1>
        <p>
          Every task, across every project. A task’s <b>kind of work</b> decides which island it is
          carried out on and which agent naturally owns it.
        </p>
      </header>

      <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
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

        <label className="row" style={{ gap: 6 }}>
          <span className="eyebrow">Island</span>
          <select className="btn btn-sm" value={islandId} onChange={(e) => setIslandId(e.target.value)}>
            <option value="">All islands</option>
            {world.islands.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>

        <span className="chip" style={{ marginLeft: 'auto' }}>
          {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
        </span>
      </div>

      {tasks.length === 0 ? (
        <EmptyState icon="📋" title="Nothing matches those filters" />
      ) : (
        <div className="board">
          {COLUMNS.filter((c) => tasks.some((t) => t.status === c.status)).map((column) => {
            const list = tasks.filter((t) => t.status === column.status);
            return (
              <section className="board-col" key={column.status}>
                <div className="col-head">
                  <span className="eyebrow">{column.label}</span>
                  <span className="count">{list.length}</span>
                </div>
                {list.map((task) => {
                  const d = toTaskDisplay(world, task);
                  return (
                    <article className="task" key={task.id}>
                      <div className="task-t">{task.title}</div>
                      {task.blocker && (
                        <div
                          className="task-n"
                          style={{ color: 'var(--bad)', fontWeight: 600, marginTop: 6 }}
                        >
                          ⚠ {task.blocker}
                        </div>
                      )}
                      <div className="tags">
                        {d.project && (
                          <Link
                            to={`/projects/${d.project.id}`}
                            className="tag"
                            style={{ textDecoration: 'none' }}
                          >
                            <span
                              className="project-swatch"
                              style={{ background: d.project.color }}
                              aria-hidden="true"
                            />
                            {d.project.name}
                          </Link>
                        )}
                        <span className="tag">
                          {TASK_TYPES[task.type].icon} {TASK_TYPES[task.type].label}
                        </span>
                        {d.bot && (
                          <Link
                            to={`/bots/${d.bot.id}`}
                            className="tag"
                            style={{ textDecoration: 'none' }}
                          >
                            <Avatar botKey={d.bot.key} size={14} />
                            {d.bot.name}
                          </Link>
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
    </div>
  );
}

export const BOARD_COLUMNS = COLUMNS;
export const TASK_STATUS_PILL = StatusPill;
