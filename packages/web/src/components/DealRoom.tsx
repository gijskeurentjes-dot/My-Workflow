import {
  DEAL_PHASES,
  dealAgentByName,
  type Agent,
  type DealAgentDefinition,
  type Project,
} from '@ai-islands/shared';

/**
 * The deal room, as a person reads it.
 *
 * An M&A deal room runs on knowing who may do what: these panels put each
 * agent's permissions, its hard restrictions and the things it has to stop and
 * ask about on the screen, next to the agent itself. The same lists are what
 * the server enforces and what the agent's brief is written from, so this is a
 * view of the rules rather than a second copy of them.
 */

/** The registry entry for an agent, when it belongs to a deal room. */
export function dealDefinitionFor(
  agent: Agent,
  project: Project | undefined,
): DealAgentDefinition | null {
  if (project?.template !== 'deal_room') return null;
  const definition = dealAgentByName(agent.name);
  // Names are editable, so a renamed agent simply has no charter to show —
  // better than showing someone else's permissions next to it.
  return definition && definition.archetype === agent.archetype ? definition : null;
}

export function DealRoomBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className="pill tone-info" title="A fixed team of five specialists.">
      <i aria-hidden="true" />
      {compact ? 'Deal room' : 'M&A Deal Room'}
    </span>
  );
}

function RuleList({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (items.length === 0) return null;
  return (
    <div className="rules">
      <div className={`eyebrow tone-text-${tone}`}>{title}</div>
      <ul className="rule-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** What this agent may do, may never do, and must ask about. */
export function AgentCharter({ definition }: { definition: DealAgentDefinition }) {
  return (
    <section className="card">
      <div className="between" style={{ marginBottom: 8 }}>
        <h4 style={{ margin: 0 }}>What {definition.name} may do</h4>
        <DealRoomBadge compact />
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {definition.description}
      </p>

      <RuleList title="May" items={definition.permissions} tone="ok" />
      <RuleList title="May never" items={definition.restrictedActions} tone="bad" />
      <RuleList title="Needs your approval first" items={definition.approvalRequiredFor} tone="warn" />
      <RuleList title="Its work must meet" items={definition.outputRequirements} tone="info" />

      <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>
        These rules are enforced by the server where they can be, not only asked
        for in the brief below.
      </p>
    </section>
  );
}

/** What this agent is usually asked to do. */
export function AgentTypicalWork({ definition }: { definition: DealAgentDefinition }) {
  return (
    <section className="card">
      <h4>Typical work</h4>
      <ul className="rule-list">
        {definition.typicalTasks.map((task) => (
          <li key={task}>{task}</li>
        ))}
      </ul>
    </section>
  );
}

/** The nine phases a deal moves through. */
export function DealPhases() {
  return (
    <section className="card">
      <div className="between" style={{ marginBottom: 8 }}>
        <h4 style={{ margin: 0 }}>Deal phases</h4>
        <span className="count">{DEAL_PHASES.length}</span>
      </div>
      <ol className="phase-list">
        {DEAL_PHASES.map((phase, i) => (
          <li key={phase.key}>
            <span className="phase-n" aria-hidden="true">
              {i + 1}
            </span>
            <span>
              <b>{phase.label}</b>
              <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>
                {phase.description}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>
        Tasks are placed in a phase from the next milestone onward.
      </p>
    </section>
  );
}
