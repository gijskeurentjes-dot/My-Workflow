import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MOVEMENT_LABEL, PLOTS, STATUS_LABEL } from '@ai-islands/shared';
import { api } from '../api/client.js';
import { AgentBrief } from '../components/AgentBrief.js';
import { AgentCharter, AgentTypicalWork, dealDefinitionFor } from '../components/DealRoom.js';
import { TaskCard } from '../components/TaskCard.js';
import {
  ActivityFeed,
  Avatar,
  EmptyState,
  ProgressBar,
  SimulatedNotice,
  StatusPill,
} from '../components/ui.js';
import { useCommands } from '../world/CommandProvider.js';
import { useWorld } from '../world/WorldProvider.js';
import { useAnimationClock, useSlowClock } from '../world/useAnimationClock.js';
import { toAgentDisplay } from '../world/selectors.js';

/**
 * One agent in full.
 *
 * The brief shown here is the same data a real engine would turn into a system
 * prompt — it is not decoration, and editing it changes how this agent behaves.
 */
export function AgentDetail() {
  const { agentId = '' } = useParams();
  const world = useWorld();
  const clock = useAnimationClock();
  const now = useSlowClock();
  const navigate = useNavigate();
  const { run, isPending } = useCommands();
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);

  const agent = world.agents.find((a) => a.id === agentId);
  const display = agent ? toAgentDisplay(world, agent, clock) : null;

  if (!agent || !display) {
    return (
      <div className="page">
        <EmptyState icon="🤖" title="No such agent" body="They may have left the project." />
        <Link to="/agents" className="btn">
          ← Back to the team
        </Link>
      </div>
    );
  }

  const { profile, task, project } = display;
  // A deal-room agent's permissions are part of who it is, so they are shown
  // here rather than buried in the brief text.
  const charter = dealDefinitionFor(agent, project);
  const activity = world.activity.filter((e) => e.agentId === agent.id);
  const history = world.tasks.filter((t) => t.assignedAgentId === agent.id);

  const dismiss = async () => {
    const ok = await run(
      `dismiss:${agent.id}`,
      () => api.dismissAgent(agent.id),
      `${agent.name} left ${project.name}`,
    );
    if (ok) navigate(`/projects/${project.id}`);
  };

  return (
    <div className="page">
      <header className="page-head">
        <Link to="/agents" className="btn btn-ghost btn-sm" style={{ marginLeft: -10 }}>
          ← All agents
        </Link>
        <div className="row" style={{ marginTop: 10, alignItems: 'flex-start' }}>
          <Avatar archetype={agent.archetype} size={52} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 22 }}>{agent.name}</h1>
            <p style={{ margin: '2px 0 0', color: 'var(--ink-3)', fontWeight: 600, fontSize: 13 }}>
              {agent.role || profile.title} ·{' '}
              <Link to={`/projects/${project.id}`}>{project.name}</Link>
            </p>
          </div>
          <StatusPill status={agent.status} />
        </div>
        <p>{charter ? charter.description : profile.tagline}</p>

        <div className="head-actions">
          {charter ? (
            <span className="muted" style={{ fontSize: 12.5 }}>
              {agent.name} is one of the five fixed agents in this deal room and cannot be
              dismissed.
            </span>
          ) : confirmingDismiss ? (
            <>
              <button
                className="btn btn-bad"
                disabled={isPending(`dismiss:${agent.id}`)}
                onClick={dismiss}
              >
                Dismiss {agent.name} from {project.name}
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirmingDismiss(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn btn-bad" onClick={() => setConfirmingDismiss(true)}>
              Dismiss…
            </button>
          )}
        </div>
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
              <SimulatedNotice compact live={display.task?.runMode === 'live'} />
            </div>
            <div className="kv">
              <span>Status</span>
              <b>{STATUS_LABEL[agent.status]}</b>
            </div>
            <div className="kv">
              <span>Doing</span>
              <b>{display.doing}</b>
            </div>
            <div className="kv">
              <span>Location</span>
              <b>
                {PLOTS[agent.currentLocation].icon} {PLOTS[agent.currentLocation].label}
              </b>
            </div>
            <div className="kv">
              <span>Movement</span>
              <b>
                {MOVEMENT_LABEL[display.movement]}
                {agent.movement ? ` → ${PLOTS[agent.movement.toKey].label}` : ''}
              </b>
            </div>
            <div className="kv">
              <span>Current task</span>
              <b>{task ? task.title : 'None'}</b>
            </div>
            {task && task.status !== 'completed' && (
              <div style={{ marginTop: 10 }}>
                <ProgressBar
                  percent={task.progress}
                  tone={
                    agent.status === 'failed' ? 'bad' : agent.status === 'paused' ? 'info' : 'ok'
                  }
                  note={
                    task.runMode === 'live' ? 'live run — milestones reached' : 'simulated progress'
                  }
                />
              </div>
            )}
          </div>

          {/* Drive the work this agent is holding, without leaving the page. */}
          {task && (
            <div className="card">
              <h4>Current task</h4>
              <TaskCard world={world} task={task} now={now} />
            </div>
          )}

          {charter && <AgentCharter definition={charter} />}
          <AgentBrief agent={agent} />
        </div>

        <div>
          <div className="card">
            <h4>
              Work history <span className="count">{history.length}</span>
            </h4>
            {history.length === 0 && <p className="muted">Nothing assigned yet.</p>}
            {history.map((t) => (
              <TaskCard key={t.id} world={world} task={t} now={now} compact />
            ))}
          </div>

          {charter && <AgentTypicalWork definition={charter} />}

          <div className="card">
            <h4>Activity</h4>
            <ActivityFeed
              events={activity.slice(0, 30)}
              now={now}
              emptyBody={`${agent.name} has not done anything yet.`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
