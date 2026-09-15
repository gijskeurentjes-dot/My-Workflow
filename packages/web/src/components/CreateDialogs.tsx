import { useState } from 'react';
import {
  ARCHETYPES,
  ARCHETYPE_KEYS,
  DEAL_AGENT_LIST,
  DEAL_ROOM_TEMPLATE,
  PLOTS,
  PRIORITY_LABEL,
  TASK_PRIORITIES,
  TASK_TYPES,
  TASK_TYPE_KEYS,
  archetypeForTaskType,
  type Agent,
  type AgentArchetype,
  type Project,
  type ProjectTemplate,
  type TaskPriority,
  type TaskType,
} from '@ai-islands/shared';
import { api } from '../api/client.js';
import { useCommands } from '../world/CommandProvider.js';
import { Dialog, Field } from './Dialog.js';
import { Avatar } from './ui.js';

const PROJECT_COLORS = ['#f4834f', '#4a8ff0', '#7a63d8', '#3aa85f', '#2bb3a3', '#cf5347'];

/**
 * Creating a project is creating an island and its team.
 *
 * A project with nobody on it can never do anything, so at least one agent is
 * always hired — the picker is about who, not whether.
 */
export function NewProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: (project: Project) => void;
}) {
  const { run, isPending } = useCommands();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(PROJECT_COLORS[0]!);
  const [team, setTeam] = useState<AgentArchetype[]>(['pm']);
  const [template, setTemplate] = useState<ProjectTemplate>('standard');

  const dealRoom = template === 'deal_room';
  const pending = isPending('create-project');
  // A deal room names itself and brings its own team, so neither is required.
  const ready = dealRoom || (name.trim().length > 0 && team.length > 0);

  const toggle = (archetype: AgentArchetype) => {
    setTeam((current) =>
      current.includes(archetype)
        ? current.filter((a) => a !== archetype)
        : [...current, archetype],
    );
  };

  const submit = async () => {
    if (!ready) return;
    let created: Project | null = null;
    const ok = await run(
      'create-project',
      async () => {
        created = await api.createProject({
          name: name.trim(),
          description: description.trim(),
          // A deal room's colour and team come from its template.
          ...(dealRoom ? { template } : { color, team }),
        });
      },
      dealRoom ? 'Deal room created' : 'Project created',
    );
    if (ok) {
      onClose();
      if (created) onCreated?.(created);
    }
  };

  return (
    <Dialog
      title="New project"
      subtitle="Every project is its own island, with its own team."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} data-secondary>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!ready || pending} onClick={submit}>
            {pending ? 'Creating…' : dealRoom ? 'Create deal room' : 'Create project'}
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
        <Field
          label="Kind of project"
          hint="A deal room comes with a fixed team of five M&A specialists."
        >
          <div className="pickrow">
            <button
              type="button"
              role="radio"
              aria-checked={!dealRoom}
              className={`pick${!dealRoom ? ' on' : ''}`}
              onClick={() => setTemplate('standard')}
            >
              <span className="pick-ico" aria-hidden="true">
                🏝️
              </span>
              <span>
                <b>Standard project</b>
                <span>Pick your own team, hire and dismiss at any time.</span>
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={dealRoom}
              className={`pick${dealRoom ? ' on' : ''}`}
              onClick={() => setTemplate('deal_room')}
            >
              <span className="pick-ico" aria-hidden="true">
                🤝
              </span>
              <span>
                <b>M&A Deal Room</b>
                <span>Atlas, Nova, Forge, Ledger and Canvas. Fixed team, nine deal phases.</span>
              </span>
            </button>
          </div>
        </Field>

        <Field label="Name" hint={dealRoom ? 'Optional — the deal room names itself.' : undefined}>
          <input
            className="input"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder={dealRoom ? DEAL_ROOM_TEMPLATE.defaultName : 'e.g. Q1 Website refresh'}
          />
        </Field>

        <Field label="Description" hint="One line on what done looks like.">
          <textarea
            className="input"
            rows={2}
            value={description}
            maxLength={600}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
          />
        </Field>

        {dealRoom ? (
          <Field
            label="The deal room team"
            hint="Fixed. Nobody else can be hired onto a deal room, and none of these can be dismissed."
          >
            <div className="pickrow">
              {DEAL_AGENT_LIST.map((definition) => (
                <div key={definition.id} className="pick on" aria-disabled="true">
                  <Avatar archetype={definition.archetype} size={28} />
                  <span>
                    <b>{definition.name}</b>
                    <span>
                      {definition.role} · works from the {PLOTS[definition.home].label}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Field>
        ) : (
        <Field
          label="Starting team"
          hint="You can hire and dismiss agents at any time afterwards."
        >
          <div className="pickrow">
            {ARCHETYPE_KEYS.map((key) => {
              const profile = ARCHETYPES[key];
              const chosen = team.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  role="checkbox"
                  aria-checked={chosen}
                  className={`pick${chosen ? ' on' : ''}`}
                  onClick={() => toggle(key)}
                >
                  <Avatar archetype={key} size={28} />
                  <span>
                    <b>{profile.title}</b>
                    <span>
                      {profile.defaultName} · works from the {PLOTS[profile.home].label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </Field>
        )}

        {!dealRoom && (
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
        )}

        {/* Enter submits, without a visible duplicate of the footer button. */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}

export function NewTaskDialog({
  projects,
  agents,
  defaultProjectId,
  onClose,
}: {
  projects: Project[];
  agents: Agent[];
  defaultProjectId?: string;
  onClose: () => void;
}) {
  const { run, isPending } = useCommands();
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<TaskType>('planning');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [needsApproval, setNeedsApproval] = useState(true);
  const [assignNow, setAssignNow] = useState(true);
  const [startNow, setStartNow] = useState(false);

  const pending = isPending('create-task');

  // The kind of work decides where it happens; the project decides who can.
  const wanted = archetypeForTaskType(type);
  const team = agents.filter((a) => a.projectId === projectId);
  const owner = team.find((a) => a.archetype === wanted) ?? null;
  const building = PLOTS[TASK_TYPES[type].building];

  const submit = async () => {
    if (!title.trim() || !projectId) return;
    const ok = await run(
      'create-task',
      () =>
        api.createTask({
          projectId,
          title: title.trim(),
          description: description.trim(),
          type,
          priority,
          needsApproval,
          agentId: assignNow ? (owner?.id ?? null) : null,
          autoStart: assignNow && startNow && owner !== null,
        }),
      startNow && assignNow && owner ? 'Task created and started' : 'Task added to the board',
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
      subtitle="The kind of work decides which building on the island it happens at."
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
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
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
            value={description}
            maxLength={1000}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
          />
        </Field>

        <Field label="Kind of work" hint="This decides where on the island it happens.">
          <div className="pickrow">
            {TASK_TYPE_KEYS.map((k) => {
              const info = TASK_TYPES[k];
              const profile = ARCHETYPES[archetypeForTaskType(k)];
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
                      {PLOTS[info.building].label} · {profile.title}
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
              Off means it is delivered straight to the depot.
            </span>
          </span>
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={assignNow}
            disabled={!owner}
            onChange={(e) => setAssignNow(e.target.checked)}
          />
          <span>
            {owner ? `Assign to ${owner.name} now` : 'Assign now'}
            <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>
              {owner
                ? `Off leaves it waiting at the ${building.label} for anyone to pick up.`
                : `Nobody on this project is a ${ARCHETYPES[wanted].title}. Hire one, or leave it on the board.`}
            </span>
          </span>
        </label>

        {assignNow && owner && (
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

/** Hire someone onto an existing project. */
export function HireAgentDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const { run, isPending } = useCommands();
  const [archetype, setArchetype] = useState<AgentArchetype>('developer');
  const [name, setName] = useState('');

  const pending = isPending('hire-agent');
  const profile = ARCHETYPES[archetype];

  const submit = async () => {
    const ok = await run(
      'hire-agent',
      () => api.hireAgent(project.id, archetype, name.trim() || undefined),
      `${name.trim() || profile.defaultName} joined ${project.name}`,
    );
    if (ok) onClose();
  };

  return (
    <Dialog
      title="Hire an agent"
      subtitle={`They join ${project.name} and work from its island.`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} data-secondary>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={pending} onClick={submit}>
            {pending ? 'Hiring…' : 'Hire'}
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
        <Field label="Kind of agent">
          <div className="pickrow">
            {ARCHETYPE_KEYS.map((key) => {
              const p = ARCHETYPES[key];
              return (
                <button
                  key={key}
                  type="button"
                  className={`pick${archetype === key ? ' on' : ''}`}
                  aria-pressed={archetype === key}
                  onClick={() => setArchetype(key)}
                >
                  <Avatar archetype={key} size={28} />
                  <span>
                    <b>{p.title}</b>
                    <span>{p.tagline}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Name" hint={`Leave blank to use “${profile.defaultName}”.`}>
          <input
            className="input"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            placeholder={profile.defaultName}
          />
        </Field>

        <div className="card" style={{ marginBottom: 4 }}>
          <p className="muted">
            Starts with the standard brief for a {profile.title}, which you can rewrite on their
            page afterwards.
          </p>
          <div className="tags" style={{ marginTop: 8 }}>
            {profile.tools.map((t) => (
              <span className="tag" key={t}>
                {t}
              </span>
            ))}
          </div>
        </div>

        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}
