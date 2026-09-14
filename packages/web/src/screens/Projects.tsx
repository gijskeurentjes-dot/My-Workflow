import { useState } from 'react';
import { Link } from 'react-router-dom';
import { NewProjectDialog } from '../components/CreateDialogs.js';
import { EmptyState, ProgressBar } from '../components/ui.js';
import { useWorld } from '../world/WorldProvider.js';
import { projectSummaries } from '../world/selectors.js';

/** Every project, with how far along it is and what needs attention. */
export function Projects() {
  const world = useWorld();
  const summaries = projectSummaries(world);
  const [creating, setCreating] = useState(false);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Projects</h1>
        <p>
          A project is a body of work. Its tasks are spread across the islands — whichever work area
          matches the kind of work each task is.
        </p>
        <div className="head-actions">
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            ＋ New project
          </button>
        </div>
      </header>

      {summaries.length === 0 ? (
        <EmptyState
          icon="🗂️"
          title="No projects yet"
          body="Create one, then add the tasks that make it happen."
        />
      ) : (
        <div className="grid-cards">
          {summaries.map(({ project, agents, tasks, doneCount, backlogCount, blockedCount, awaitingCount, percent }) => (
            <Link key={project.id} to={`/projects/${project.id}`} className="list-card">
              <div className="row" style={{ marginBottom: 6 }}>
                <span
                  className="project-swatch"
                  style={{ background: project.color, width: 12, height: 12 }}
                  aria-hidden="true"
                />
                <b style={{ fontSize: 15, flex: 1, minWidth: 0 }}>{project.name}</b>
                {blockedCount > 0 && <span className="pill tone-bad">{blockedCount} blocked</span>}
                {blockedCount === 0 && awaitingCount > 0 && (
                  <span className="pill tone-warn">{awaitingCount} to approve</span>
                )}
              </div>
              <p className="muted">{project.description || 'No description yet.'}</p>
              <div className="isle-meta" style={{ marginTop: 8 }}>
                <span>
                  <b>{agents.length}</b> agents
                </span>
                <span>
                  <b>{backlogCount}</b> waiting
                </span>
                <span>
                  <b>{project.crates}</b> delivered
                </span>
              </div>
              <ProgressBar
                percent={percent}
                note={
                  tasks.length === 0 ? 'No tasks yet' : `${doneCount} of ${tasks.length} delivered`
                }
              />
            </Link>
          ))}
        </div>
      )}

      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
