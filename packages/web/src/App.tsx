import type { ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Activity } from './screens/Activity.js';
import { Approvals } from './screens/Approvals.js';
import { AgentDetail } from './screens/AgentDetail.js';
import { Agents } from './screens/Agents.js';
import { ProjectDetail } from './screens/ProjectDetail.js';
import { Projects } from './screens/Projects.js';
import { Settings } from './screens/Settings.js';
import { TaskBoard } from './screens/TaskBoard.js';
import { Workspace } from './screens/Workspace.js';
import { Toasts } from './components/Toasts.js';
import { useWorldContext } from './world/WorldProvider.js';

const NAV = [
  { to: '/', icon: '🏝️', label: 'Workspace', end: true },
  { to: '/projects', icon: '🗂️', label: 'Projects' },
  { to: '/tasks', icon: '📋', label: 'Tasks' },
  { to: '/agents', icon: '🤖', label: 'Agents' },
  { to: '/approvals', icon: '✋', label: 'Approvals' },
  { to: '/activity', icon: '📜', label: 'Activity' },
  { to: '/settings', icon: '⚙️', label: 'Settings' },
] as const;

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width="20" height="20" viewBox="-12 -10 24 20">
        <ellipse cx="0" cy="3" rx="10" ry="5" fill="#6b4a33" />
        <ellipse cx="0" cy="1" rx="10" ry="5" fill="#5fb35a" />
        <rect x="-3" y="-6" width="6" height="6" rx="1" fill="#fdfaf2" />
        <polygon points="-4,-6 4,-6 0,-10" fill="#e8734a" />
      </svg>
    </span>
  );
}

function ConnectionChip() {
  const { connection } = useWorldContext();
  const label =
    connection === 'live'
      ? 'Live'
      : connection === 'connecting'
        ? 'Connecting…'
        : connection === 'reconnecting'
          ? 'Reconnecting…'
          : 'Offline';
  const tone = connection === 'live' ? '' : connection === 'error' ? ' off' : ' pending';

  return (
    <span className="chip" title={`Live updates: ${label}`}>
      <i className={`live-dot${tone}`} aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * The application shell.
 *
 * A permanent nav on the left, so every screen is one click away and none of
 * them is reachable only through the visual world.
 */
export function App() {
  const { world } = useWorldContext();
  const pendingApprovals = world?.approvals.filter((a) => a.status === 'pending').length ?? 0;

  const counts: Record<string, number> = {
    '/projects': world?.projects.length ?? 0,
    '/tasks': world?.stats.tasksOpen ?? 0,
    '/agents': world?.agents.length ?? 0,
    '/approvals': pendingApprovals,
  };

  return (
    <>
      <a className="sr-only skip-link" href="#main">
        Skip to main content
      </a>

      <header className="topbar">
        <NavLink to="/" className="brand">
          <BrandMark />
          <span className="brand-name">AI Islands</span>
        </NavLink>
        <span className="spacer" />
        <span className="chip hide-sm" title="No AI model is called. Every agent here is simulated.">
          Simulated world · no real AI work
        </span>
        <ConnectionChip />
      </header>

      <div className="shell">
        <nav className="nav" aria-label="Main">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={'end' in item ? item.end : false} className="nav-link">
              <span className="nav-ico" aria-hidden="true">
                {item.icon}
              </span>
              <span className="nav-label">{item.label}</span>
              {counts[item.to] !== undefined && counts[item.to]! > 0 && (
                <span className={`nav-count${item.to === '/approvals' ? ' attention' : ''}`}>
                  {counts[item.to]}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <main className="main" id="main">
          <WorldGate>
            <Routes>
              <Route path="/" element={<Workspace />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/:projectId" element={<ProjectDetail />} />
              <Route path="/tasks" element={<TaskBoard />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/agents/:agentId" element={<AgentDetail />} />
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/activity" element={<Activity />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </WorldGate>
        </main>
      </div>

      <Toasts />
    </>
  );
}

/**
 * Holds every screen back until the world has loaded.
 *
 * Doing it once here is what lets each screen call `useWorld()` without a null
 * check on every field.
 */
function WorldGate({ children }: { children: ReactNode }) {
  const { world, connection, error } = useWorldContext();

  if (world) return <>{children}</>;

  if (connection === 'error') {
    return (
      <div className="page">
        <div className="banner error" style={{ maxWidth: 560 }}>
          <span aria-hidden="true">⚠</span>
          <span>
            <b>Could not reach the world.</b>
            <br />
            {error ?? 'The API did not respond.'}
            <br />
            <br />
            Start the server with <code>npm run dev</code> from the repository root, then reload.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="page" aria-busy="true">
      <div className="empty">
        <span className="em" aria-hidden="true">
          🏝️
        </span>
        <b>Finding the islands…</b>
        <p>Connecting to the live world.</p>
      </div>
    </div>
  );
}
