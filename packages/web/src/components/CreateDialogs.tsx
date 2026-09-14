import { useState } from 'react';
import {
  BOT_PROFILES,
  PRIORITY_LABEL,
  TASK_PRIORITIES,
  TASK_TYPES,
  TASK_TYPE_KEYS,
  defaultBotForTaskType,
  type Bot,
  type Island,
  type Project,
  type TaskPriority,
  type TaskType,
} from '@ai-islands/shared';
import { api } from '../api/client.js';
import { useCommands } from '../world/CommandProvider.js';
import { Dialog, Field } from './Dialog.js';
import { Avatar } from './ui.js';

const PROJECT_COLORS = ['#f4834f', '#4a8ff0', '#7a63d8', '#3aa85f', '#2bb3a3', '#cf5347'];

export function NewProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: (project: Project) => void;
}) {
  const { run, isPending } = useCommands();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [color, setColor] = useState(PROJECT_COLORS[0]!);

  const pending = isPending('create-project');

  const submit = async () => {
    if (!name.trim()) return;
    let created: Project | null = null;
    const ok = await run(
      'create-project',
      async () => {
        created = await api.createProject({ name: name.trim(), goal: goal.trim(), color });
      },
      'Project created',
    );
    if (ok) {
      onClose();
      if (created) onCreated?.(created);
    }
  };

  return (
    <Dialog
      title="New project"
      subtitle="A body of work. Its tasks spread across the islands as you add them."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} data-secondary>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!name.trim() || pending} onClick={submit}>
            {pending ? 'Creating…' : 'Create project'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Name">
          <input
            className="input"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Q1 Website refresh"
          />
        </Field>

        <Field label="Goal" hint="One line on what done looks like.">
          <textarea
            className="input"
            rows={2}
            value={goal}
            maxLength={600}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Optional"
          />
        </Field>

        <Field label="Colour">
          <div className="swatches" role="radiogroup" aria-label="Project colour">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={`Colour ${c}`}
                className={`swatch${color === c ? ' on' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </Field>

        {/* Enter submits, without a visible duplicate of the footer button. */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}

export function NewTaskDialog({
  projects,
  bots,
  islands,
  defaultProjectId,
  onClose,
}: {
  projects: Project[];
  bots: Bot[];
  islands: Island[];
  defaultProjectId?: string;
  onClose: () => void;
}) {
  const { run, isPending } = useCommands();
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [type, setType] = useState<TaskType>('planning');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [needsApproval, setNeedsApproval] = useState(true);
  const [assignNow, setAssignNow] = useState(true);
  const [startNow, setStartNow] = useState(false);

  const pending = isPending('create-task');

  // The kind of work decides both where it happens and who naturally owns it.
  const preferredKey = defaultBotForTaskType(type);
  const preferredBot = bots.find((b) => b.key === preferredKey);
  const island = islands.find((i) => i.key === TASK_TYPES[type].island);

  const submit = async () => {
    if (!title.trim() || !projectId) return;
    const ok = await run(
      'create-task',
      () =>
        api.createTask({
          projectId,
          title: title.trim(),
          notes: notes.trim(),
          type,
          priority,
          needsApproval,
          botId: assignNow ? (preferredBot?.id ?? null) : null,
          autoStart: assignNow && startNow,
        }),
      startNow && assignNow ? 'Task created and started' : 'Task added to the board',
    );
    if (ok) onClose();
  };

  if (projects.length === 0) {
    return (
      <Dialog
        title="New task"
        onClose={onClose}
        footer={
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        }
      >
        <p className="muted">Every task belongs to a project. Create a project first.</p>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="New task"
      subtitle="The kind of work decides which island it happens on."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} data-secondary>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!title.trim() || pending} onClick={submit}>
            {pending ? 'Adding…' : 'Add task'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Project">
          <select
            className="input"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Title">
          <input
            className="input"
            value={title}
            maxLength={160}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Write the release notes"
          />
        </Field>

        <Field label="Details">
          <textarea
            className="input"
            rows={2}
            value={notes}
            maxLength={1000}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional"
          />
        </Field>

        <Field label="Kind of work" hint="This decides where it happens and who owns it.">
          <div className="pickrow">
            {TASK_TYPE_KEYS.map((k) => {
              const info = TASK_TYPES[k];
              const owner = BOT_PROFILES[defaultBotForTaskType(k)];
              const where = islands.find((i) => i.key === info.island);
              return (
                <button
                  key={k}
                  type="button"
                  className={`pick${type === k ? ' on' : ''}`}
                  aria-pressed={type === k}
                  onClick={() => setType(k)}
                >
                  <span style={{ fontSize: 17 }} aria-hidden="true">
                    {info.icon}
                  </span>
                  <span>
                    <b>{info.label}</b>
                    <span>
                      {where?.name ?? info.island} · {owner.name}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Priority" hint="Urgent work is picked up before anything else.">
          <div className="row" role="radiogroup" aria-label="Priority">
            {TASK_PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={priority === p}
                className={`btn btn-sm${priority === p ? ' btn-primary' : ''}`}
                onClick={() => setPriority(p)}
              >
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
        </Field>

        <label className="check">
          <input
            type="checkbox"
            checked={needsApproval}
            onChange={(e) => setNeedsApproval(e.target.checked)}
          />
          <span>
            Ask me to approve the result before it is delivered
            <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>
              Off means {preferredBot?.name ?? 'the agent'} delivers straight to the depot.
            </span>
          </span>
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={assignNow}
            onChange={(e) => setAssignNow(e.target.checked)}
          />
          <span>
            Assign to {preferredBot?.name ?? 'the natural owner'} now
            <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>
              Off leaves it on the board at {island?.name ?? 'its island'} for anyone to pick up.
            </span>
          </span>
        </label>

        {assignNow && (
          <label className="check">
            <input
              type="checkbox"
              checked={startNow}
              onChange={(e) => setStartNow(e.target.checked)}
            />
            <span>Start it straight away</span>
          </label>
        )}

        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}

export { Avatar };
