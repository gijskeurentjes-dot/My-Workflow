import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { TaskStatus } from '@ai-islands/shared';
import { api } from '../api/client.js';
import { NewTaskDialog } from '../components/CreateDialogs.js';
import { TaskCard } from '../components/TaskCard.js';
import { ActivityFeed, EmptyState, ProgressBar } from '../components/ui.js';
import { useCommands } from '../world/CommandProvider.js';
import { useWorld } from '../world/WorldProvider.js';
import { useSlowClock } from '../world/useAnimationClock.js';

/** Order the board reads in: what needs you first, finished work last. */
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

export function ProjectDetail() {
  const { projectId = '' } = useParams();
  const world = useWorld();
  const now = useSlowClock();
  const navigate = useNavigate();
  const { run, isPending } = useCommands();

  const [addingTask, setAddingTask] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const project = world.projects.find((p) => p.id === projectId);
  const [draftName, setDraftName] = useState(project?.name ?? '');
  const [draftGoal, setDraftGoal] = useState(project?.goal ?? '');

  if (!project) {
    return (
      <div className="page">
        <EmptyState icon="🗂️" title="No such project" body="It may have been deleted." />
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

  const saveEdits = async () => {
    const ok = await run(
      `project:${project.id}`,
      () => api.updateProject(project.id, { name: draftName, goal: draftGoal }),
      'Project updated',
    );
    if (ok) setEditing(false);
  };

  const deleteProject = async () => {
    const ok = await run(
      `delete-project:${project.id}`,
      () => api.deleteProject(project.id),
      'Project deleted',
    );
    if (ok) navigate('/projects');
  };

  return (
    <div className="page">
      <header className="page-head">
        <Link to="/projects" className="btn btn-ghost btn-sm" style={{ marginLeft: -10 }}>
          ← Projects
        </Link>

        {editing ? (
          <div className="card" style={{ maxWidth: 560, marginTop: 10 }}>
            <div className="field">
              <div className="label">Name</div>
              <input
                className="input"
                value={draftName}
                maxLength={120}
                onChange={(e) => setDraftName(e.target.value)}
              />
            </div>
            <div className="field">
              <div className="label">Goal</div>
              <textarea
                className="input"
                rows={2}
                value={draftGoal}
                maxLength={600}
                onChange={(e) => setDraftGoal(e.target.value)}
              />
            </div>
            <div className="row">
              <button
                className="btn btn-sm btn-primary"
                disabled={!draftName.trim() || isPending(`project:${project.id}`)}
                onClick={saveEdits}
              >
                Save
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setDraftName(project.name);
                  setDraftGoal(project.goal);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="row" style={{ marginTop: 8 }}>
              <span
                className="project-swatch"
                style={{ background: project.color, width: 14, height: 14 }}
                aria-hidden="true"
              />
              <h1>{project.name}</h1>
            </div>
            <p>{project.goal || 'No goal set.'}</p>
          </>
        )}

        <div className="head-actions">
          <button className="btn btn-primary" onClick={() => setAddingTask(true)}>
            ＋ New task
          </button>
          {!editing && (
            <button
              className="btn"
              onClick={() => {
                setDraftName(project.name);
                setDraftGoal(project.goal);
                setEditing(true);
              }}
            >
              Edit
            </button>
          )}
          {confirmingDelete ? (
            <>
              <button
                className="btn btn-bad"
                disabled={isPending(`delete-project:${project.id}`)}
                onClick={deleteProject}
              >
                Delete project and its {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn btn-bad" onClick={() => setConfirmingDelete(true)}>
              Delete…
            </button>
          )}
        </div>
      </header>

      <div className="card" style={{ maxWidth: 520 }}>
        <h4>Progress</h4>
        <ProgressBar
          percent={percent}
          note={tasks.length === 0 ? 'No tasks yet' : `${done} of ${tasks.length} tasks delivered`}
        />
      </div>

      <h2 style={{ fontSize: 17, margin: '22px 0 12px' }}>Tasks</h2>
      {tasks.length === 0 ? (
        <EmptyState
          icon="📋"
          title="No tasks in this project yet"
          body="Add one and an agent will carry it out on the island that matches the work."
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
                    showProject={false}
                    showIsland
                    showStatus={false}
                  />
                ))}
              </section>
            );
          })}
        </div>
      )}

      <h2 style={{ fontSize: 17, margin: '26px 0 12px' }}>Activity</h2>
      <div className="card" style={{ maxWidth: 680 }}>
        <ActivityFeed events={activity.slice(0, 25)} now={now} />
      </div>

      {addingTask && (
        <NewTaskDialog
          projects={world.projects}
          bots={world.bots}
          islands={world.islands}
          defaultProjectId={project.id}
          onClose={() => setAddingTask(false)}
        />
      )}
    </div>
  );
}
