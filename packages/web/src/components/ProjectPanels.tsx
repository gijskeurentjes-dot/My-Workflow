import { useState } from 'react';
import {
  PROJECT_FILE_KINDS,
  type Milestone,
  type Project,
  type ProjectFile,
  type ProjectFileKind,
  type Task,
} from '@ai-islands/shared';
import { api } from '../api/client.js';
import { useCommands } from '../world/CommandProvider.js';
import { Field } from './Dialog.js';
import { ProgressBar, timeAgo } from './ui.js';

/**
 * The parts of a project that are not tasks.
 *
 * Goals, where the code lives, what it is working towards and what it has —
 * the things you would put on a wall. They are edited in place rather than in
 * dialogs, because they are read far more often than they are changed and a
 * modal in front of a goal you are trying to read is a small cruelty.
 */

const DAY = 86_400_000;

/** What done looks like, and where the code lives. */
export function ProjectBrief({ project }: { project: Project }) {
  const { run, isPending } = useCommands();
  const [editing, setEditing] = useState(false);
  const [goals, setGoals] = useState(project.goals);
  const [repository, setRepository] = useState(project.repository);

  const key = `brief:${project.id}`;
  const pending = isPending(key);

  const save = async () => {
    const ok = await run(
      key,
      () => api.updateProject(project.id, { goals, repository }),
      'Project brief updated',
    );
    if (ok) setEditing(false);
  };

  if (!editing) {
    return (
      <section className="card">
        <div className="between" style={{ marginBottom: 8 }}>
          <h4 style={{ margin: 0 }}>What done looks like</h4>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setGoals(project.goals);
              setRepository(project.repository);
              setEditing(true);
            }}
          >
            Edit
          </button>
        </div>

        {project.goals ? (
          <ul className="rule-list">
            {project.goals
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line, i) => (
                <li key={i}>{line}</li>
              ))}
          </ul>
        ) : (
          <p className="muted" style={{ marginTop: 0 }}>
            No goals written yet. A project without them is hard to call finished.
          </p>
        )}

        <div className="kv" style={{ marginTop: 10 }}>
          <span>Repository</span>
          {project.repository ? (
            <b className="mono" style={{ overflowWrap: 'anywhere' }}>
              {project.repository.startsWith('http') ? (
                <a href={project.repository} target="_blank" rel="noreferrer noopener">
                  {project.repository}
                </a>
              ) : (
                project.repository
              )}
            </b>
          ) : (
            <b className="muted">None linked</b>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <h4>What done looks like</h4>
      <Field label="Goals" hint="One per line. These are what the project is judged against.">
        <textarea
          className="input"
          rows={4}
          value={goals}
          maxLength={2000}
          onChange={(e) => setGoals(e.target.value)}
          placeholder="e.g. The pricing page is live and converting at least as well as the old one."
        />
      </Field>
      <Field label="Repository" hint="A URL or a path. Optional.">
        <input
          className="input"
          value={repository}
          maxLength={400}
          onChange={(e) => setRepository(e.target.value)}
          placeholder="github.com/example/project"
        />
      </Field>
      <div className="acts">
        <button className="btn btn-sm btn-primary" disabled={pending} onClick={save}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </section>
  );
}

/** What the project is working towards, and how far along each one is. */
export function Milestones({
  project,
  milestones,
  tasks,
  now,
}: {
  project: Project;
  milestones: Milestone[];
  tasks: Task[];
  now: number;
}) {
  const { run, isPending } = useCommands();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [dueInDays, setDueInDays] = useState('14');

  const add = async () => {
    if (!title.trim()) return;
    const days = Number.parseInt(dueInDays, 10);
    const ok = await run(
      `milestone:${project.id}`,
      () =>
        api.createMilestone(project.id, {
          title: title.trim(),
          dueAt: Number.isFinite(days) && days > 0 ? Date.now() + days * DAY : null,
        }),
      'Milestone added',
    );
    if (ok) {
      setTitle('');
      setAdding(false);
    }
  };

  return (
    <section className="card">
      <div className="between" style={{ marginBottom: 8 }}>
        <h4 style={{ margin: 0 }}>
          Milestones <span className="count">{milestones.length}</span>
        </h4>
        <button className="btn btn-sm btn-ghost" onClick={() => setAdding((v) => !v)}>
          ＋ Add
        </button>
      </div>

      {milestones.length === 0 && !adding && (
        <p className="muted" style={{ marginTop: 0 }}>
          Nothing to work towards yet. A milestone turns “nine tasks open” into “two tasks from
          done”.
        </p>
      )}

      {milestones.map((milestone) => {
        const mine = tasks.filter((t) => t.milestoneId === milestone.id);
        const done = mine.filter((t) => t.status === 'completed').length;
        const percent = mine.length === 0 ? 0 : Math.round((done / mine.length) * 100);
        const overdue = milestone.status === 'open' && milestone.dueAt !== null && milestone.dueAt < now;

        return (
          <div key={milestone.id} className="milestone">
            <div className="between">
              <b>{milestone.title}</b>
              <span className="row" style={{ gap: 6 }}>
                {milestone.status === 'hit' ? (
                  <span className="pill tone-violet">
                    <i aria-hidden="true" />
                    Hit
                  </span>
                ) : (
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={isPending(`milestone:${milestone.id}`)}
                    onClick={() =>
                      run(
                        `milestone:${milestone.id}`,
                        () => api.updateMilestone(project.id, milestone.id, { status: 'hit' }),
                        `“${milestone.title}” hit`,
                      )
                    }
                  >
                    Mark hit
                  </button>
                )}
                <button
                  className="icon-btn"
                  title="Remove this milestone"
                  aria-label={`Remove ${milestone.title}`}
                  onClick={() =>
                    run(
                      `milestone:${milestone.id}`,
                      () => api.deleteMilestone(project.id, milestone.id),
                      'Milestone removed',
                    )
                  }
                >
                  ✕
                </button>
              </span>
            </div>
            <div className="barnote" style={{ marginTop: 2 }}>
              <span>
                {done}/{mine.length} task{mine.length === 1 ? '' : 's'}
              </span>
              <span className={overdue ? 'tone-text-bad' : undefined}>
                {milestone.dueAt === null
                  ? 'no date'
                  : overdue
                    ? `overdue — was due ${timeAgo(milestone.dueAt, now)}`
                    : `due in ${Math.max(1, Math.round((milestone.dueAt - now) / DAY))} days`}
              </span>
            </div>
            <ProgressBar percent={percent} tone={overdue ? 'bad' : 'ok'} />
          </div>
        );
      })}

      {adding && (
        <div style={{ marginTop: 10 }}>
          <input
            className="input"
            value={title}
            maxLength={160}
            autoFocus
            placeholder="e.g. Pricing page live"
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="row" style={{ marginTop: 6, gap: 8 }}>
            <label className="row" style={{ gap: 6 }}>
              <span className="eyebrow">Due in</span>
              <input
                className="input"
                style={{ width: 70 }}
                value={dueInDays}
                onChange={(e) => setDueInDays(e.target.value)}
              />
              <span className="muted">days — blank for no date</span>
            </label>
          </div>
          <div className="acts">
            <button className="btn btn-sm btn-primary" disabled={!title.trim()} onClick={add}>
              Add milestone
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** What the project has, and what its agents produced. */
export function ProjectFiles({
  project,
  files,
  tasks,
  now,
}: {
  project: Project;
  files: ProjectFile[];
  tasks: Task[];
  now: number;
}) {
  const { run, isPending } = useCommands();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ProjectFileKind>('document');
  const [location, setLocation] = useState('');

  const add = async () => {
    if (!name.trim()) return;
    const ok = await run(
      `file:${project.id}`,
      () => api.addFile(project.id, { name: name.trim(), kind, location: location.trim() }),
      'File added',
    );
    if (ok) {
      setName('');
      setLocation('');
      setAdding(false);
    }
  };

  return (
    <section className="card">
      <div className="between" style={{ marginBottom: 8 }}>
        <h4 style={{ margin: 0 }}>
          Project files <span className="count">{files.length}</span>
        </h4>
        <button className="btn btn-sm btn-ghost" onClick={() => setAdding((v) => !v)}>
          ＋ Add
        </button>
      </div>

      <p className="muted" style={{ marginTop: 0, fontSize: 11.5 }}>
        References, not copies: a name, a kind and where it lives. A file linked to a task is that
        task’s deliverable.
      </p>

      {files.length === 0 && !adding && <p className="muted">Nothing recorded yet.</p>}

      {files.map((file) => {
        const task = tasks.find((t) => t.id === file.taskId);
        return (
          <div className="kv" key={file.id}>
            <span>
              {file.location ? (
                <a href={file.location} target="_blank" rel="noreferrer noopener">
                  {file.name}
                </a>
              ) : (
                file.name
              )}
              <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>
                {file.kind}
                {task ? ` · from “${task.title}”` : ''} · {timeAgo(file.createdAt, now)}
              </span>
            </span>
            <button
              className="icon-btn"
              title="Remove this reference"
              aria-label={`Remove ${file.name}`}
              disabled={isPending(`file:${file.id}`)}
              onClick={() =>
                run(`file:${file.id}`, () => api.removeFile(project.id, file.id), 'Reference removed')
              }
            >
              ✕
            </button>
          </div>
        );
      })}

      {adding && (
        <div style={{ marginTop: 10 }}>
          <input
            className="input"
            value={name}
            maxLength={200}
            autoFocus
            placeholder="e.g. competitor-scan.md"
            onChange={(e) => setName(e.target.value)}
          />
          <div className="row" style={{ marginTop: 6, gap: 8, flexWrap: 'wrap' }}>
            <select
              className="btn btn-sm"
              value={kind}
              aria-label="Kind of file"
              onChange={(e) => setKind(e.target.value as ProjectFileKind)}
            >
              {PROJECT_FILE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <input
              className="input"
              style={{ flex: 1, minWidth: 180 }}
              value={location}
              maxLength={600}
              placeholder="Where it lives — a URL or a path"
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          <div className="acts">
            <button className="btn btn-sm btn-primary" disabled={!name.trim()} onClick={add}>
              Add file
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
