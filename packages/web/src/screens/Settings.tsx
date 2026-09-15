import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import {
  ARCHETYPES,
  ARCHETYPE_LIST,
  PLOTS,
  STREAM_PATH,
  type AgentArchetype,
  type UsageReport,
} from '@ai-islands/shared';
import { Avatar } from '../components/ui.js';
import { useTheme } from '../useTheme.js';
import { useWorldContext, useWorld } from '../world/WorldProvider.js';

/** Appearance, engine status, the agent roster, and the demo-data reset. */
export function Settings() {
  const world = useWorld();
  const { connection, resetDemoData, resetting } = useWorldContext();
  const { preference, setTheme } = useTheme();
  const [confirming, setConfirming] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const onReset = async () => {
    setResetError(null);
    try {
      await resetDemoData();
      setConfirming(false);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'The reset failed.');
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Settings</h1>
        <p>How the world looks, what is driving it, and how to start over.</p>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <div>
          <section className="card">
            <h4>Appearance</h4>
            <p className="muted" style={{ marginBottom: 10 }}>
              The islands repaint to match — each biome has its own night palette.
            </p>
            <div className="row" role="group" aria-label="Theme">
              {(['system', 'light', 'dark'] as const).map((option) => (
                <button
                  key={option}
                  className={`btn btn-sm${preference === option ? ' btn-primary' : ''}`}
                  aria-pressed={preference === option}
                  onClick={() => setTheme(option)}
                >
                  {option[0]!.toUpperCase() + option.slice(1)}
                </button>
              ))}
            </div>
          </section>

          <section className="card">
            <h4>Agent engine</h4>
            <div className="banner">
              <span aria-hidden="true">⚠️</span>
              <span>
                The simulation drives the world: walking, progress, approvals and deliveries. A task
                run for real bypasses it — the model reports what it is doing, and the simulation
                only walks the agent there.
              </span>
            </div>
            <div className="kv">
              <span>Engine</span>
              <b className="mono">{world.engine.kind}</b>
            </div>
            <div className="kv">
              <span>Running</span>
              <b>{world.engine.running ? 'Yes' : 'No'}</b>
            </div>
            <div className="kv">
              <span>Tick interval</span>
              <b className="mono">{world.engine.tickMs}ms</b>
            </div>
            <div className="kv">
              <span>Live connection</span>
              <b>{connection === 'live' ? 'Connected' : connection}</b>
            </div>
            <div className="kv">
              <span>Stream</span>
              <b className="mono">{STREAM_PATH}</b>
            </div>
            <p className="muted" style={{ marginTop: 12 }}>
              Each agent carries what a live one needs: responsibilities that read as a system
              prompt, a tool list, and its approval rules. Running a task for real uses exactly
              those, and writes the same states the simulation does — which is why the interface did
              not have to change to show it.
            </p>
          </section>

          <section className="card">
            <h4>Real agents</h4>
            <div className="kv">
              <span>Live execution</span>
              <b>{world.runtime.available ? 'Available' : 'Not configured'}</b>
            </div>
            <div className="kv">
              <span>API key</span>
              {/* Whether one is set. Never which one. */}
              <b>{world.runtime.credentialsConfigured ? 'Configured' : 'Not set'}</b>
            </div>
            <div className="kv">
              <span>Model</span>
              <b className="mono">{world.runtime.model}</b>
            </div>
            <div className="kv">
              <span>Can run for real</span>
              <b>
                {world.runtime.archetypes.length
                  ? world.runtime.archetypes
                      .map((key) => ARCHETYPES[key as AgentArchetype]?.title ?? key)
                      .join(', ')
                  : 'Nobody yet'}
              </b>
            </div>
            <div className="kv">
              <span>Searches per run</span>
              <b className="mono">{world.runtime.maxSearches}</b>
            </div>
            <UsagePanel />

            {!world.runtime.credentialsConfigured && (
              <p className="muted" style={{ marginTop: 12 }}>
                Set <span className="mono">ANTHROPIC_API_KEY</span> in{' '}
                <span className="mono">.env</span> and restart the server to run the Researcher for
                real. Without it everything keeps working on the simulation.
              </p>
            )}
          </section>
        </div>

        <div>
          <section className="card">
            <h4>
              Kinds of agent <span className="count">{ARCHETYPE_LIST.length}</span>
            </h4>
            <p className="muted" style={{ marginBottom: 10 }}>
              Every project hires its own team from these. An agent’s brief is editable afterwards,
              so two projects can run very different Developers.
            </p>
            {ARCHETYPE_LIST.map((profile) => (
              <div className="row" key={profile.key} style={{ padding: '8px 0' }}>
                <Avatar archetype={profile.key} size={30} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 13 }}>{profile.title}</b>
                  <div className="bot-role">
                    works from the {PLOTS[profile.home].label} · suggested name {profile.defaultName}
                  </div>
                </div>
              </div>
            ))}
          </section>

          <section className="card">
            <h4>
              Your projects <span className="count">{world.projects.length}</span>
            </h4>
            {world.projects.map((project) => (
              <div className="kv" key={project.id}>
                <span>{project.name}</span>
                <b>
                  {world.agents.filter((a) => a.projectId === project.id).length}{' '}
                  {world.agents.filter((a) => a.projectId === project.id).length === 1
                    ? 'agent'
                    : 'agents'}
                </b>
              </div>
            ))}
          </section>

          <section className="card">
            <h4>Safety</h4>
            <p className="muted">
              Agents cannot hire other agents — only you can add one, so nothing spawns itself in
              a loop. Work that needs approval is never delivered without your decision, and every
              action an agent takes is written to the activity log.
            </p>
          </section>

          <section className="card" style={{ borderColor: 'var(--bad)' }}>
            <h4 style={{ color: 'var(--bad)' }}>Reset demo data</h4>
            <p className="muted">
              Wipes every project, task, approval and activity entry, then rebuilds the starting
              world. This cannot be undone.
            </p>

            {resetError && (
              <div className="banner error" style={{ marginTop: 10, marginBottom: 0 }}>
                <span aria-hidden="true">⚠</span>
                <span>{resetError}</span>
              </div>
            )}

            {confirming ? (
              <div className="row" style={{ marginTop: 12 }}>
                <button
                  className="btn btn-sm"
                  style={{ background: 'var(--bad)', color: '#fff', borderColor: 'transparent' }}
                  onClick={onReset}
                  disabled={resetting}
                >
                  {resetting ? 'Resetting…' : 'Yes, reset everything'}
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setConfirming(false)}
                  disabled={resetting}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="btn btn-sm"
                style={{ marginTop: 12, color: 'var(--bad)', borderColor: 'var(--bad)' }}
                onClick={() => setConfirming(true)}
              >
                Reset demo data…
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * What live runs have actually cost.
 *
 * Only real runs are counted — the simulation costs nothing and appears
 * nowhere here. Before anything has run for real the panel says so plainly
 * rather than showing a row of confident zeroes, because a zero reads as a
 * measurement and "nothing has happened yet" is not one.
 */
function UsagePanel() {
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .usage()
      .then(setUsage)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return null;

  const total = usage?.total;

  return (
    <>
      <div className="kv" style={{ marginTop: 14 }}>
        <span>Live runs so far</span>
        <b>{total ? total.runs : '—'}</b>
      </div>
      {total && total.runs > 0 && (
        <>
          <div className="kv">
            <span>Tokens used</span>
            <b className="mono">
              {total.inputTokens.toLocaleString()} in / {total.outputTokens.toLocaleString()} out
            </b>
          </div>
          <div className="kv">
            <span>Web searches</span>
            <b className="mono">{total.webSearches}</b>
          </div>
          <div className="kv">
            <span>Model time</span>
            <b className="mono">{(total.durationMs / 1000).toFixed(1)}s</b>
          </div>
          {usage && usage.byProject.length > 0 && (
            <p className="muted" style={{ marginTop: 10, fontSize: 11.5 }}>
              Most of it on{' '}
              <b>{usage.byProject[0]!.name}</b>
              {usage.byProject.length > 1 ? ` and ${usage.byProject.length - 1} other` : ''}
              {usage.byProject.length > 2 ? 's' : ''}.
            </p>
          )}
        </>
      )}
      {total && total.runs === 0 && (
        <p className="muted" style={{ marginTop: 6, fontSize: 11.5 }}>
          Nothing has run for real yet, so there is nothing to count. The simulation costs nothing.
        </p>
      )}
    </>
  );
}
