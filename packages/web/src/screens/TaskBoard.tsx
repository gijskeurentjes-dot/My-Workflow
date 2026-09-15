import { useMemo, useState } from 'react';
import { BOARD_COLUMNS, boardColumnFor, type BoardColumnKey } from '@ai-islands/shared';
import { NewTaskDialog } from '../components/CreateDialogs.js';
import { TaskCard } from '../components/TaskCard.js';
import { EmptyState } from '../components/ui.js';
import { useWorld } from '../world/WorldProvider.js';
import { useSlowClock } from '../world/useAnimationClock.js';

/**
 * Every task, in seven lanes.
 *
 * All seven are always drawn, including the empty ones: a board whose columns
 * come and go with their contents is a board you cannot learn the shape of, and
 * an empty lane is information — nothing is waiting on you, nothing has failed.
 *
 * Subtasks sit under the task they break out of rather than floating as peers,
 * so a lane reads as a list of work rather than a list of fragments.
 */
export function TaskBoard() {
  const world = useWorld();
  const now = useSlowClock();
  const [projectId, setProjectId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [adding, setAdding] = useState(false);

  const tasks = useMemo(
    () =>
      world.tasks.filter(
        (t) =>
          (!projectId || t.projectId === projectId) &&
          (!assignedTo ||
            (assignedTo === 'unassigned' ? !t.assignedAgentId : t.assignedAgentId === assignedTo)),
      ),
    [world.tasks, projectId, assignedTo],
  );

  const byColumn = useMemo(() => {
    const map = new Map<BoardColumnKey, typeof tasks>();
    for (const column of BOARD_COLUMNS) map.set(column.key, []);
    for (const task of tasks) {
      // A subtask is shown beneath its parent, not as a card of its own — as
      // long as the parent is on this board too.
      if (task.parentTaskId && tasks.some((t) => t.id === task.parentTaskId)) continue;
      map.get(boardColumnFor(task.status))?.push(task);
    }
    return map;
  }, [tasks]);

  const agents = projectId ? world.agents.filter((a) => a.projectId === projectId) : world.agents;

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
            onChange={(e) => {
              setProjectId(e.target.value);
              setAssignedTo('');
            }}
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
          <span className="eyebrow">Assigned to</span>
          <select
            className="btn btn-sm"
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
          >
            <option value="">Anyone</option>
            <option value="unassigned">Nobody yet</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>

        <span className="chip" style={{ marginLeft: 'auto' }}>
          {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
        </span>
      </div>

      {world.tasks.length === 0 ? (
        <EmptyState icon="📋" title="No tasks yet" body="Add one to get an agent moving." />
      ) : (
        <div className="board">
          {BOARD_COLUMNS.map((column) => {
            const list = byColumn.get(column.key) ?? [];
            return (
              <section className="board-col" key={column.key}>
                <div className="col-head" title={column.description}>
                  <span className="eyebrow">{column.label}</span>
                  <span className="count">{list.length}</span>
                </div>
                {list.length === 0 ? (
                  <p className="col-empty">{column.description}</p>
                ) : (
                  list.map((task) => (
                    <TaskCard
                      key={task.id}
                      world={world}
                      task={task}
                      now={now}
                      showStatus={column.statuses.length > 1}
                      showProject={!projectId}
                      compact
                    />
                  ))
                )}
              </section>
            );
          })}
        </div>
      )}

      {adding && (
        <NewTaskDialog
          projects={world.projects}
          agents={world.agents}
          tasks={world.tasks}
          milestones={world.milestones}
          {...(projectId ? { defaultProjectId: projectId } : {})}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}
