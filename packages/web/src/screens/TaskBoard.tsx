import { useMemo, useState } from 'react';
import { PLOTS, PLOT_KEYS, type TaskStatus } from '@ai-islands/shared';
import { NewTaskDialog } from '../components/CreateDialogs.js';
import { TaskCard } from '../components/TaskCard.js';
import { EmptyState } from '../components/ui.js';
import { useWorld } from '../world/WorldProvider.js';
import { useSlowClock } from '../world/useAnimationClock.js';

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'waiting_approval', label: 'Waiting for approval' },
  { status: 'failed', label: 'Blocked' },
  { status: 'working', label: 'In progress' },
  { status: 'delivering', label: 'Delivering' },
  { status: 'paused', label: 'Paused' },
  { status: 'backlog', label: 'On the board' },
  { status: 'completed', label: 'Delivered' },
  { status: 'cancelled', label: 'Cancelled' },
];

/** Every task across every project, grouped by what state it is in. */
export function TaskBoard() {
  const world = useWorld();
  const now = useSlowClock();
  const [projectId, setProjectId] = useState('');
  const [buildingKey, setBuildingKey] = useState('');
  const [adding, setAdding] = useState(false);

  const tasks = useMemo(
    () =>
      world.tasks.filter(
        (t) =>
          (!projectId || t.projectId === projectId) &&
          (!buildingKey || t.buildingKey === buildingKey),
      ),
    [world.tasks, projectId, buildingKey],
  );

  return (
    <div className="page">
      <header className="page-head">
        <h1>Task board</h1>
        <p>
          Every task, across every project. A task’s <b>kind of work</b> decides which island it is
          carried out on and which agent naturally owns it.
        </p>
        <div className="head-actions">
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            ＋ New task
          </button>
        </div>
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
          <span className="eyebrow">Building</span>
          <select
            className="btn btn-sm"
            value={buildingKey}
            onChange={(e) => setBuildingKey(e.target.value)}
          >
            <option value="">Anywhere on the island</option>
            {PLOT_KEYS.map((key) => (
              <option key={key} value={key}>
                {PLOTS[key].label}
              </option>
            ))}
          </select>
        </label>

        <span className="chip" style={{ marginLeft: 'auto' }}>
          {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
        </span>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon="📋"
          title={world.tasks.length === 0 ? 'No tasks yet' : 'Nothing matches those filters'}
          {...(world.tasks.length === 0 ? { body: 'Add one to get an agent moving.' } : {})}
        />
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
                {list.map((task) => (
                  <TaskCard
                    key={task.id}
                    world={world}
                    task={task}
                    now={now}
                    showStatus={false}
                    compact
                  />
                ))}
              </section>
            );
          })}
        </div>
      )}

      {adding && (
        <NewTaskDialog
          projects={world.projects}
          agents={world.agents}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}
