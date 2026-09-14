import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BOT_PROFILES,
  TASK_TYPES,
  defaultBotForTaskType,
  isTerminalTaskStatus,
  type Bot,
  type Task,
  type WorldSnapshot,
} from '@ai-islands/shared';
import { api } from '../api/client.js';
import { useCommands } from '../world/CommandProvider.js';
import { toTaskDisplay } from '../world/selectors.js';
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
  showIsland = false,
  showStatus = true,
  compact = false,
}: {
  world: WorldSnapshot;
  task: Task;
  now: number;
  showProject?: boolean;
  showIsland?: boolean;
  /** Off inside a status-grouped column, where the heading already says it. */
  showStatus?: boolean;
  compact?: boolean;
}) {
  const d = toTaskDisplay(world, task);
  const { run, isPending } = useCommands();
  const [assigning, setAssigning] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const key = (action: string) => `${action}:${task.id}`;
  const busy = ['start', 'pause', 'cancel', 'retry', 'reset', 'assign', 'delete'].some((a) =>
    isPending(key(a)),
  );

  const approval = world.approvals.find((a) => a.taskId === task.id && a.status === 'pending');

  const canStart = task.status === 'backlog' || task.status === 'paused';
  const canPause = task.status === 'working';
  const canRetry = task.status === 'failed';
  const canCancel = !isTerminalTaskStatus(task.status);
  const canReset = task.status === 'cancelled' || task.status === 'completed';
  const showProgress =
    task.status === 'working' ||
    task.status === 'paused' ||
    task.status === 'failed' ||
    task.status === 'cancelled';

  const progressTone =
    task.status === 'failed'
      ? 'bad'
      : task.status === 'paused'
        ? 'info'
        : task.status === 'cancelled'
          ? 'warn'
          : 'ok';

  const preferredKey = defaultBotForTaskType(task.type);

  return (
    <article className="task">
      <div className="task-t">{task.title}</div>
      {task.notes && !compact && <div className="task-n">{task.notes}</div>}

      {task.blocker && (
        <div className="task-n" style={{ color: 'var(--bad)', fontWeight: 600, marginTop: 6 }}>
          <span aria-hidden="true">⚠</span> {task.blocker}
        </div>
      )}

      <div className="tags">
        {showStatus && <StatusPill status={task.status} />}
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
        {showIsland && d.island && <span className="tag">{d.island.name}</span>}
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
                  : 'simulated progress'
          }
        />
      )}

      {/* Work waiting on a decision is decided here, not only in the queue. */}
      {approval && (
        <div className="acts" style={{ marginTop: 10 }}>
          <button
            className="btn btn-sm btn-primary"
            disabled={isPending(`approve:${approval.id}`)}
            onClick={() =>
              run(`approve:${approval.id}`, () => api.approve(approval.id), 'Approved — on its way to the depot')
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
        {canStart && (
          <button
            className="btn btn-sm btn-primary"
            disabled={busy}
            onClick={() => run(key('start'), () => api.startTask(task.id))}
          >
            ▶ {task.status === 'paused' ? 'Resume' : 'Start'}
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
            onClick={() => run(key('cancel'), () => api.cancelTask(task.id), 'Cancelled')}
          >
            ⏹ Cancel
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
            {d.bot ? 'Reassign' : 'Assign'}
          </button>
        )}

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
          bots={world.bots}
          currentBotId={task.botId}
          preferredKey={preferredKey}
          disabled={busy}
          onPick={async (botId) => {
            const ok = await run(key('assign'), () => api.assignTask(task.id, botId));
            if (ok) setAssigning(false);
          }}
          onCancel={() => setAssigning(false)}
        />
      )}
    </article>
  );
}

/**
 * Pick an agent for a task.
 *
 * Any agent can take any task — one given work on another island travels there.
 * The natural owner is marked so the easy choice is also the obvious one.
 */
function AssignPicker({
  bots,
  currentBotId,
  preferredKey,
  disabled,
  onPick,
  onCancel,
}: {
  bots: Bot[];
  currentBotId: string | null;
  preferredKey: string;
  disabled: boolean;
  onPick: (botId: string) => void;
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
      {bots.map((bot) => {
        const profile = BOT_PROFILES[bot.key];
        const isCurrent = bot.id === currentBotId;
        return (
          <button
            key={bot.id}
            className="assign-option"
            disabled={disabled || isCurrent}
            onClick={() => onPick(bot.id)}
          >
            <Avatar botKey={bot.key} size={26} />
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <b style={{ fontSize: 12.5, display: 'block' }}>{bot.name}</b>
              <span className="bot-role">
                {profile.title}
                {bot.key === preferredKey ? ' · natural owner' : ''}
                {isCurrent ? ' · already assigned' : ''}
              </span>
            </span>
            <StatusPill status={bot.status} />
          </button>
        );
      })}
    </div>
  );
}
