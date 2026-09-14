import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PLOTS, PLOT_KEYS, type PlotKey, type TaskStatus } from '@ai-islands/shared';
import { api } from '../api/client.js';
import { HireAgentDialog, NewTaskDialog } from '../components/CreateDialogs.js';
import { TaskCard } from '../components/TaskCard.js';
import {
  ActivityFeed,
  Avatar,
  EmptyState,
  ProgressBar,
  StatusPill,
} from '../components/ui.js';
import { useTheme } from '../useTheme.js';
import { useCommands } from '../world/CommandProvider.js';
import { useWorld } from '../world/WorldProvider.js';
import { useAnimationClock, useSlowClock } from '../world/useAnimationClock.js';
import { agentsForProject } from '../world/selectors.js';
import { IslandScene } from '../world/scene/IslandScene.js';

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

/**
 * A project and its island, on one page.
 *
 * The island is the project: its team walks between the buildings, and a task's
 * kind of work decides which building it is carried out at.
 */
export function ProjectDetail() {
  const { projectId = '' } = useParams();
  const world = useWorld();
  const { theme } = useTheme();
  const clock = useAnimationClock();
  const now = useSlowClock();
  const navigate = useNavigate();
  const { run, isPending } = useCommands();

  const [addingTask, setAddingTask] = useState(false);
  const [hiring, setHiring] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedPlot, setSelectedPlot] = useState<PlotKey | null>(null);

  const project = world.projects.find((p) => p.id === projectId);
  const [draftName, setDraftName] = useState(project?.name ?? '');
  const [draftDescription, setDraftDescription] = useState(project?.description ?? '');

  if (!project) {
    return (
      <div className="page">
        <EmptyState icon="🏝️" title="No such project" body="It may have been deleted." />
        <Link to="/projects" className="btn">
          ← Back to projects
        </Link>
      </div>
    );
  }

  const agents = agentsForProject(world, project.id, clock);
  const tasks = world.tasks.filter((t) => t.projectId === project.id);
  const done = tasks.filter((t) => t.status === 'completed').length;
  const percent = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const activity = world.activity.filter((e) => e.projectId === project.id);
  const openTasks = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');

  const plotInfo = selectedPlot ? PLOTS[selectedPlot] : null;
  const agentsAtPlot = selectedPlot
    ? agents.filter(
        (d) =>
          (d.agent.movement ? d.agent.movement.toKey : d.agent.currentLocation) === selectedPlot,
      )
    : [];
  const tasksAtPlot = selectedPlot
    ? openTasks.filter((t) => t.buildingKey === selectedPlot)
    : [];

  const saveEdits = async () => {
    const ok = await run(
      `project:${project.id}`,
      () => api.updateProject(project.id, { name: draftName, description: draftDescription }),
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
    <div className="workspace">
      <div className="canvas">
        <IslandScene
          project={project}
          agents={agents}
          tasks={tasks}
          clock={clock}
          theme={theme}
          selectedAgentId={selectedAgentId}
          selectedPlot={selectedPlot}
          onSelectAgent={(id) => navigate(`/agents/${id}`)}
          onSelectPlot={(key) => setSelectedPlot((cur) => (cur === key ? null : key))}
          onClearSelection={() => {
            setSelectedAgentId(null);
            setSelectedPlot(null);
          }}
        />
      </div>

      <aside className="rail" aria-label={`${project.name} details`}>
        <div className="rail-pad">
          <Link to="/projects" className="btn btn-ghost btn-sm" style={{ marginLeft: -8 }}>
            ← All projects
          </Link>

          {editing ? (
            <div style={{ marginTop: 10 }}>
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
                <div className="label">Description</div>
                <textarea
                  className="input"
                  rows={2}
                  value={draftDescription}
                  maxLength={600}
                  onChange={(e) => setDraftDescription(e.target.value)}
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
                    setDraftDescription(project.description);
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="row" style={{ marginTop: 6 }}>
                <span
                  className="project-swatch"
                  style={{ background: project.color, width: 12, height: 12 }}
                  aria-hidden="true"
                />
                <h2 style={{ fontSize: 19 }}>{project.name}</h2>
              </div>
              <p className="muted" style={{ marginTop: 4 }}>
                {project.description || 'No description yet.'}
              </p>
            </>
          )}

          <div className="head-actions" style={{ marginTop: 10 }}>
            <button className="btn btn-sm btn-primary" onClick={() => setAddingTask(true)}>
              ＋ Task
            </button>
            <button className="btn btn-sm" onClick={() => setHiring(true)}>
              ＋ Hire
            </button>
            {!editing && (
              <button
                className="btn btn-sm"
                onClick={() => {
                  setDraftName(project.name);
                  setDraftDescription(project.description);
                  setEditing(true);
                }}
              >
                Edit
              </button>
            )}
          </div>
        </div>

        <div className="rail-scroll">
          <div className="stat-grid" style={{ marginBottom: 14 }}>
            <div className="stat">
              <b>{agents.length}</b>
              <span>Team</span>
            </div>
            <div className="stat">
              <b>{openTasks.length}</b>
              <span>Open</span>
            </div>
            <div className="stat">
              <b>{project.crates}</b>
              <span>Delivered</span>
            </div>
          </div>

          <div className="card">
            <h4>Progress</h4>
            <ProgressBar
              percent={percent}
              note={tasks.length === 0 ? 'No tasks yet' : `${done} of ${tasks.length} delivered`}
            />
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
              {agentsAtPlot.length > 0 && (
                <div className="tags">
                  {agentsAtPlot.map((d) => (
                    <Link
                      key={d.agent.id}
                      to={`/agents/${d.agent.id}`}
                      className="tag"
                      style={{ textDecoration: 'none' }}
                    >
                      <Avatar archetype={d.agent.archetype} size={14} />
                      {d.agent.name}
                    </Link>
                  ))}
                </div>
              )}
              {tasksAtPlot.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {tasksAtPlot.map((t) => (
                    <TaskCard key={t.id} world={world} task={t} now={now} showProject={false} compact />
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="card">
            <div className="between" style={{ marginBottom: 8 }}>
              <h4 style={{ margin: 0 }}>
                The team <span className="count">{agents.length}</span>
              </h4>
              <button className="btn btn-sm btn-ghost" onClick={() => setHiring(true)}>
                ＋ Hire
              </button>
            </div>
            {agents.length === 0 && (
              <p className="muted">Nobody on this island yet. Hire someone to get it moving.</p>
            )}
            {agents.map((d) => (
              <Link
                key={d.agent.id}
                to={`/agents/${d.agent.id}`}
                className="bot-card"
                onMouseEnter={() => setSelectedAgentId(d.agent.id)}
                onMouseLeave={() => setSelectedAgentId(null)}
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
            <div style={{ display: 'grid', gap: 6 }}>
              {PLOT_KEYS.map((key) => {
                const here = agents.filter(
                  (d) =>
                    (d.agent.movement ? d.agent.movement.toKey : d.agent.currentLocation) === key,
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
                    {here > 0 && (
                      <span className="count" style={{ marginLeft: 'auto' }}>
                        {here}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <h3 style={{ fontSize: 15, margin: '18px 0 10px' }}>Tasks</h3>
          {tasks.length === 0 ? (
            <EmptyState
              icon="📋"
              title="No tasks yet"
              body="Add one and an agent will carry it out at the matching building."
            />
          ) : (
            COLUMNS.filter((c) => tasks.some((t) => t.status === c.status)).map((column) => {
              const list = tasks.filter((t) => t.status === column.status);
              return (
                <div key={column.status} style={{ marginBottom: 12 }}>
                  <div className="col-head" style={{ display: 'flex', gap: 7, marginBottom: 8 }}>
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
                      showStatus={false}
                    />
                  ))}
                </div>
              );
            })
          )}

          <div className="card">
            <h4>Activity</h4>
            <ActivityFeed events={activity.slice(0, 25)} now={now} />
          </div>

          <div className="card" style={{ borderColor: 'var(--bad)' }}>
            <h4 style={{ color: 'var(--bad)' }}>Danger zone</h4>
            <p className="muted">
              Deleting this project sinks its island, and takes its {agents.length}{' '}
              {agents.length === 1 ? 'agent' : 'agents'} and {tasks.length}{' '}
              {tasks.length === 1 ? 'task' : 'tasks'} with it.
            </p>
            {confirmingDelete ? (
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  className="btn btn-sm btn-bad"
                  disabled={isPending(`delete-project:${project.id}`)}
                  onClick={deleteProject}
                >
                  Yes, delete it all
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="btn btn-sm btn-bad"
                style={{ marginTop: 10 }}
                onClick={() => setConfirmingDelete(true)}
              >
                Delete this project…
              </button>
            )}
          </div>
        </div>
      </aside>

      {addingTask && (
        <NewTaskDialog
          projects={world.projects}
          agents={world.agents}
          defaultProjectId={project.id}
          onClose={() => setAddingTask(false)}
        />
      )}
      {hiring && <HireAgentDialog project={project} onClose={() => setHiring(false)} />}
    </div>
  );
}
