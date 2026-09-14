import { useState } from 'react';
import type { Agent } from '@ai-islands/shared';
import { api } from '../api/client.js';
import { useCommands } from '../world/CommandProvider.js';
import { Field } from './Dialog.js';

/**
 * An agent's brief, and the form for changing it.
 *
 * These three fields are not documentation. `instructions` is what a real
 * engine sends as this agent's system prompt, `tools` is what it may reach for,
 * and both are stored per agent — so an agent's behaviour can change without a
 * deploy, and two projects can run very different Developers.
 */
export function AgentBrief({ agent }: { agent: Agent }) {
  const { run, isPending } = useCommands();
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState(agent.role);
  const [instructions, setInstructions] = useState(agent.instructions);
  const [toolsText, setToolsText] = useState(agent.tools.join('\n'));

  const key = `agent:${agent.id}`;
  const pending = isPending(key);

  const startEditing = () => {
    setRole(agent.role);
    setInstructions(agent.instructions);
    setToolsText(agent.tools.join('\n'));
    setEditing(true);
  };

  const save = async () => {
    const ok = await run(
      key,
      () =>
        api.updateAgent(agent.id, {
          role,
          instructions,
          tools: toolsText
            .split('\n')
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      `${agent.name}’s brief was updated`,
    );
    if (ok) setEditing(false);
  };

  if (!editing) {
    return (
      <>
        <section className="card">
          <div className="between" style={{ marginBottom: 9 }}>
            <h4 style={{ margin: 0 }}>Brief</h4>
            <button className="btn btn-sm" onClick={startEditing}>
              Edit
            </button>
          </div>
          <div className="kv">
            <span>Role</span>
            <b>{agent.role || '—'}</b>
          </div>
          <p className="muted" style={{ marginTop: 10, marginBottom: 6 }}>
            What a live engine would send as this agent’s system prompt:
          </p>
          <pre className="brief">{agent.instructions || 'No instructions set.'}</pre>
        </section>

        <section className="card">
          <h4>
            Tools <span className="count">{agent.tools.length}</span>
          </h4>
          <p className="muted" style={{ marginBottom: 8 }}>
            What this agent is allowed to reach for.
          </p>
          <div className="tags" style={{ marginTop: 0 }}>
            {agent.tools.length === 0 && <span className="muted">No tools assigned.</span>}
            {agent.tools.map((tool) => (
              <span className="tag" key={tool}>
                {tool}
              </span>
            ))}
          </div>
        </section>
      </>
    );
  }

  return (
    <section className="card" style={{ borderColor: 'var(--brand)' }}>
      <div className="between" style={{ marginBottom: 12 }}>
        <h4 style={{ margin: 0 }}>Editing {agent.name}’s brief</h4>
      </div>

      <Field label="Role">
        <input
          className="input"
          value={role}
          maxLength={120}
          onChange={(e) => setRole(e.target.value)}
          placeholder="e.g. Staff Engineer"
        />
      </Field>

      <Field
        label="Instructions"
        hint="Sent verbatim as the system prompt once a real engine is behind this agent."
      >
        <textarea
          className="input"
          rows={10}
          value={instructions}
          maxLength={8000}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </Field>

      <Field label="Tools" hint="One per line.">
        <textarea
          className="input"
          rows={5}
          value={toolsText}
          onChange={(e) => setToolsText(e.target.value)}
          placeholder={'Repository access\nTest runner'}
        />
      </Field>

      <div className="row">
        <button className="btn btn-sm btn-primary" disabled={pending} onClick={save}>
          {pending ? 'Saving…' : 'Save brief'}
        </button>
        <button
          className="btn btn-sm btn-ghost"
          disabled={pending}
          onClick={() => setEditing(false)}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
