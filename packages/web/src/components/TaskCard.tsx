import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ARCHETYPES,
  PLOTS,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  TASK_PRIORITIES,
  TASK_TYPES,
  archetypeForTaskType,
  isTerminalTaskStatus,
  type Agent,
  type Task,
  type TaskPriority,
  type WorldSnapshot,
} from '@ai-islands/shared';
import { api } from '../api/client.js';
import { useCommands } from '../world/CommandProvider.js';
import { toTaskDisplay } from '../world/selectors.js';
import { TaskResultPanel } from './TaskResult.js';
import { Avatar, ProgressBar, StatusPill, timeAgo } from './ui.js';

/**
 * One task, everywhere it appears.
 *
 * The controls are derived from the task's status, so a button is only offered
 * when the transition behind it is actually legal. The server enforces the same
 * rules — the disabling here is a courtesy, not the guard.
 */
export function TaskCard({
  world,
  task,
  now,
  showProject = true,
  showStatus = true,
  compact = false,
}: {
  world: WorldSnapshot;
  task: Task;
  now: number;
  showProject?: boolean;
  /** Off inside a status-grouped column, where the heading already says it. */
  showStatus?: boolean;
  compact?: boolean;
}) {
  const d = toTaskDisplay(world, task);
  const { run, isPending } = useCommands();
  const [assigning, setAssigning] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [changingPriority, setChangingPriority] = useState(false);

  const key = (action: string) => `${action}:${task.id}`;
  const busy = [
    'start',
    'run',
    'pause',
    'cancel',
    'retry',
    'reset',
    'assign',
    'delete',
    'priority',
  ].some((a) => isPending(key(a)));

  const approval = world.approvals.find((a) => a.taskId === task.id && a.status === 'pending');

  const live = task.runMode === 'live';
  // A live run is a real agent doing real work: it is offered only when the
  // server says it could actually happen, for an agent that has an engine.
  const canRunForReal =
    world.runtime.available &&
    d.agent !== null &&
    world.runtime.archetypes.includes(d.agent.archetype) &&
    (task.status === 'backlog' || task.status === 'paused' || task.status === 'failed');
  const running = task.status === 'working' || task.status === 'queued';

  const canStart = task.status === 'backlog' || task.status === 'paused';
  // A model call cannot be suspended and picked up later, so pause is not
  // offered for one — the server refuses it too.
  const canPause = task.status === 'working' && !live;
  const canRetry = task.status === 'failed' && !canRunForReal;
  const canCancel = !isTerminalTaskStatus(task.status);
  const canReset = task.status === 'cancelled' || task.status === 'completed';
  const showProgress =
    running ||
    task.status === 'paused' ||
    task.status === 'failed' ||
    task.status === 'cancelled';
  // The result of a real run is worth reading wherever the task appears.
  const showResult =
    live &&
    (task.status === 'waiting_approval' ||
      task.status === 'completed' ||
      task.status === 'delivering' ||
      task.status === 'failed');

  const progressTone =
    task.status === 'failed'
      ? 'bad'
      : task.status === 'paused'
        ? 'info'
        : task.status === 'cancelled'
          ? 'warn'
          : 'ok';

  // Only this project's team can take the work, so that is who is offered.
  const team = world.agents.filter((a) => a.projectId === task.projectId);
  const preferred = archetypeForTaskType(task.type);

  return (
    <article className="task">
      <div className="task-t">{task.title}</div>
      {task.description && !compact && <div className="task-n">{task.description}</div>}

      {task.blocker && (
        <div className="task-n" style={{ color: 'var(--bad)', fontWeight: 600, marginTop: 6 }}>
          <span aria-hidden="true">⚠</span> {task.blocker}
        </div>
      )}

      <div className="tags">
        {showStatus && <StatusPill status={task.status} />}
        {live && (
          <span
            className="pill tone-violet"
            title={`This work is being done by a real agent on ${world.runtime.model}.`}
          >
            <i aria-hidden="true" />
            live agent
          </span>
        )}
        {task.priority !== 'normal' && (
          <span className={`pill tone-${PRIORITY_TONE[task.priority]}`}>
            <i aria-hidden="true" />
            {PRIORITY_LABEL[task.priority]}
          </span>
        )}
        {showProject && d.project && (
          <Link to={`/projects/${d.project.id}`} className="tag" style={{ textDecoration: 'none' }}>
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
        {/* Where on the island it happens. */}
        <span className="tag">
          {PLOTS[task.buildingKey].icon} {PLOTS[task.buildingKey].label}
        </span>
        {d.agent ? (
          <Link to={`/agents/${d.agent.id}`} className="tag" style={{ textDecoration: 'none' }}>
            <Avatar archetype={d.agent.archetype} size={14} />
            {d.agent.name}
          </Link>
        ) : (
          <span className="tag" style={{ color: 'var(--ink-3)' }}>
            Unassigned
          </span>
        )}
        {!task.needsApproval && !isTerminalTaskStatus(task.status) && (
          <span className="tag" title="This work will be delivered without asking you first.">
            delivers without approval
          </span>
        )}
        {task.status === 'completed' && task.completedAt && (
          <span className="tag">delivered {timeAgo(task.completedAt, now)}</span>
        )}
      </div>

      {showProgress && (
        <ProgressBar
          percent={task.progress}
          tone={progressTone}
          note={
            task.status === 'paused'
              ? 'paused — progress held'
              : task.status === 'failed'
                ? 'blocked'
                : task.status === 'cancelled'
                  ? 'cancelled — progress kept for the record'
                  : live
                    ? // Never "n% done": nothing knows how much of a research
                      // run is left. This counts what has actually happened.
                      'live run — milestones reached'
                    : 'simulated progress'
          }
        />
      )}

      {/* Work waiting on a decision is decided here, not only in the queue. */}
      {approval && (
        <div className="approval-ask">
          <span className="eyebrow">Waiting for your decision</span>
          <p>{approval.summary}</p>
        </div>
      )}

      {showResult && <TaskResultPanel taskId={task.id} now={now} />}

      {approval && (
        <div className="acts" style={{ marginTop: 10 }}>
          <button
            className="btn btn-sm btn-primary"
            disabled={isPending(`approve:${approval.id}`)}
            onClick={() =>
              run(
                `approve:${approval.id}`,
                () => api.approve(approval.id),
                'Approved — on its way to the depot',
              )
            }
          >
            ✓ Approve
          </button>
          <button
            className="btn btn-sm"
            disabled={isPending(`reject:${approval.id}`)}
            onClick={() =>
              run(`reject:${approval.id}`, () => api.reject(approval.id), 'Sent back for changes')
            }
          >
            ↩ Send back
          </button>
        </div>
      )}

      <div className="acts">
        {canRunForReal && (
          <button
            className="btn btn-sm btn-primary"
            disabled={busy}
            title={`${d.agent?.name} will do this for real on ${world.runtime.model}.`}
            onClick={() =>
              run(key('run'), () => api.runTask(task.id), `${d.agent?.name ?? 'The agent'} is on it`)
            }
          >
            ✦ {task.status === 'failed' ? 'Run again' : 'Run for real'}
          </button>
        )}
        {canStart && (
          <button
            className={`btn btn-sm${canRunForReal ? '' : ' btn-primary'}`}
            disabled={busy}
            title={
              canRunForReal
                ? 'Simulate this work instead of calling a model.'
                : undefined
            }
            onClick={() => run(key('start'), () => api.startTask(task.id))}
          >
            ▶ {task.status === 'paused' ? 'Resume' : canRunForReal ? 'Simulate' : 'Start'}
          </button>
        )}
        {canPause && (
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={() => run(key('pause'), () => api.pauseTask(task.id))}
          >
            ⏸ Pause
          </button>
        )}
        {canRetry && (
          <button
            className="btn btn-sm btn-primary"
            disabled={busy}
            onClick={() => run(key('retry'), () => api.retryTask(task.id), 'Retrying')}
          >
            ↻ Retry
          </button>
        )}
        {canCancel && (
          <button
            className="btn btn-sm btn-bad"
            disabled={busy}
            title={live && running ? 'Stops the agent mid-run.' : undefined}
            onClick={() => run(key('cancel'), () => api.cancelTask(task.id), 'Cancelled')}
          >
            ⏹ {live && running ? 'Stop the run' : 'Cancel'}
          </button>
        )}
        {canReset && (
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={() => run(key('reset'), () => api.resetTask(task.id), 'Back on the board')}
          >
            ↺ Put back on the board
          </button>
        )}
        {!isTerminalTaskStatus(task.status) && (
          <button className="btn btn-sm" disabled={busy} onClick={() => setAssigning((v) => !v)}>
            {d.agent ? 'Reassign' : 'Assign'}
          </button>
        )}
        {!isTerminalTaskStatus(task.status) &&
          (changingPriority ? (
            <select
              className="btn btn-sm"
              aria-label={`Priority for ${task.title}`}
              value={task.priority}
              disabled={busy}
              autoFocus
              onBlur={() => setChangingPriority(false)}
              onChange={async (e) => {
                const next = e.target.value as TaskPriority;
                await run(key('priority'), () => api.updateTask(task.id, { priority: next }));
                setChangingPriority(false);
              }}
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          ) : (
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() => setChangingPriority(true)}
              title="Priority decides what an idle agent picks up first"
            >
              Priority
            </button>
          ))}

        {!confirmingDelete ? (
          <button
            className="icon-btn"
            title="Delete this task"
            aria-label={`Delete ${task.title}`}
            style={{ marginLeft: 'auto' }}
            onClick={() => setConfirmingDelete(true)}
          >
            ✕
          </button>
        ) : (
          <span className="row" style={{ marginLeft: 'auto', gap: 6 }}>
            <span className="muted" style={{ fontSize: 11.5 }}>
              Delete?
            </span>
            <button
              className="btn btn-sm btn-bad"
              disabled={busy}
              onClick={() => run(key('delete'), () => api.deleteTask(task.id), 'Task deleted')}
            >
              Yes
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setConfirmingDelete(false)}>
              No
            </button>
          </span>
        )}
      </div>

      {assigning && (
        <AssignPicker
          team={team}
          projectName={d.project?.name ?? 'this project'}
          currentAgentId={task.assignedAgentId}
          preferred={preferred}
          disabled={busy}
          onPick={async (agentId) => {
            const ok = await run(key('assign'), () => api.assignTask(task.id, agentId));
            if (ok) setAssigning(false);
          }}
          onCancel={() => setAssigning(false)}
        />
      )}
    </article>
  );
}

/**
 * Pick someone from this project's team.
 *
 * Only the project's own agents are offered: a team is what a project has, and
 * borrowing someone from elsewhere is a transfer, done from their own page.
 */
function AssignPicker({
  team,
  projectName,
  currentAgentId,
  preferred,
  disabled,
  onPick,
  onCancel,
}: {
  team: Agent[];
  projectName: string;
  currentAgentId: string | null;
  preferred: string;
  disabled: boolean;
  onPick: (agentId: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="assign-picker">
      <div className="between" style={{ marginBottom: 6 }}>
        <span className="eyebrow">Assign to</span>
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {team.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          Nobody is on {projectName} yet. Hire someone from the project page.
        </p>
      )}

      {team.map((agent) => {
        const isCurrent = agent.id === currentAgentId;
        return (
          <button
            key={agent.id}
            className="assign-option"
            disabled={disabled || isCurrent}
            onClick={() => onPick(agent.id)}
          >
            <Avatar archetype={agent.archetype} size={26} />
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <b style={{ fontSize: 12.5, display: 'block' }}>{agent.name}</b>
              <span className="bot-role">
                {agent.role || ARCHETYPES[agent.archetype].title}
                {agent.archetype === preferred ? ' · natural owner' : ''}
                {isCurrent ? ' · already assigned' : ''}
              </span>
            </span>
            <StatusPill status={agent.status} />
          </button>
        );
      })}
    </div>
  );
}
