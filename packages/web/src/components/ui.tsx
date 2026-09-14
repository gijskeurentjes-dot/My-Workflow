import { Link } from 'react-router-dom';
import {
  ARCHETYPES,
  STATUS_LABEL,
  STATUS_TONE,
  type ActivityEvent,
  type ActivityEventType,
  type AgentArchetype,
  type AgentStatus,
  type RuntimeInfo,
  type TaskStatus,
} from '@ai-islands/shared';

/** A status as a coloured pill. The one place a status becomes a colour. */
export function StatusPill({ status }: { status: AgentStatus | TaskStatus }) {
  return (
    <span className={`pill tone-${STATUS_TONE[status]}`}>
      <i aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Avatar({ archetype, size = 38 }: { archetype: AgentArchetype; size?: number }) {
  const profile = ARCHETYPES[archetype];
  return (
    <div
      className="avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        background: `linear-gradient(150deg, ${profile.color.base}, ${profile.color.dark})`,
        fontSize: size * 0.44,
      }}
    >
      {profile.icon}
    </div>
  );
}

export function ProgressBar({
  percent,
  tone = 'ok',
  note,
}: {
  percent: number;
  tone?: string;
  note?: string;
}) {
  const rounded = Math.round(percent);
  return (
    <>
      <div
        className={`bar ${tone}`}
        role="progressbar"
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={note ?? 'Task progress'}
      >
        <i style={{ width: `${rounded}%` }} />
      </div>
      {note && (
        <div className="barnote">
          <span className="mono">{rounded}%</span>
          <span>{note}</span>
        </div>
      )}
    </>
  );
}

export function EmptyState({ icon, title, body }: { icon: string; title: string; body?: string }) {
  return (
    <div className="empty">
      <span className="em" aria-hidden="true">
        {icon}
      </span>
      <b>{title}</b>
      {body && <p>{body}</p>}
    </div>
  );
}

/** Relative time, rounded to whatever unit reads best. */
export function timeAgo(timestamp: number, now: number = Date.now()): string {
  const s = Math.max(1, Math.round((now - timestamp) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const LOG_STYLE: Record<string, { tone: string; icon: string }> = {
  delivered: { tone: 'violet', icon: '\u{1F4E6}' },
  hired: { tone: 'ok', icon: '\u{1F916}' },
  dismissed: { tone: 'mute', icon: '\u{1F44B}' },
  approval_requested: { tone: 'warn', icon: '✋' },
  approved: { tone: 'ok', icon: '✓' },
  rejected: { tone: 'warn', icon: '↩' },
  started: { tone: 'ok', icon: '▶' },
  resumed: { tone: 'ok', icon: '▶' },
  paused: { tone: 'info', icon: '⏸' },
  cancelled: { tone: 'mute', icon: '⏹' },
  blocked: { tone: 'bad', icon: '⚠' },
  retried: { tone: 'info', icon: '↻' },
  assigned: { tone: 'info', icon: '\u{1F4CC}' },
  created: { tone: 'mute', icon: '➕' },
  progress: { tone: 'ok', icon: '…' },
  arrived: { tone: 'info', icon: '\u{1F6B6}' },
  departed: { tone: 'mute', icon: '\u{1F6B6}' },
  system: { tone: 'mute', icon: '⚙' },
};

export const logStyle = (eventType: ActivityEventType) => LOG_STYLE[eventType] ?? LOG_STYLE.system!;

export function ActivityFeed({
  events,
  now,
  emptyBody,
}: {
  events: ActivityEvent[];
  now: number;
  emptyBody?: string;
}) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon="\u{1F4DC}"
        title="Nothing has happened yet"
        body={emptyBody ?? 'Activity shows up here as the agents work.'}
      />
    );
  }

  return (
    <ul className="feed" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {events.map((event) => {
        const style = logStyle(event.eventType);
        return (
          <li className="feed-row" key={event.id}>
            <span
              className="feed-dot"
              aria-hidden="true"
              style={{ background: `var(--${style.tone}-bg)`, color: `var(--${style.tone})` }}
            >
              {style.icon}
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="feed-text">{event.message}</span>
              <span className="feed-time" style={{ display: 'block' }}>
                <time dateTime={new Date(event.timestamp).toISOString()}>
                  {timeAgo(event.timestamp, now)}
                </time>
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Says plainly which of these agents are real.
 *
 * It used to say "everything here is simulated", which was true and is no
 * longer: a Researcher can be run against a real model. Saying so precisely —
 * which archetypes are live, and that the rest are not — is the whole point of
 * the notice, so it takes the runtime rather than assuming.
 */
export function SimulatedNotice({
  runtime,
  compact = false,
  live = false,
}: {
  runtime?: RuntimeInfo;
  compact?: boolean;
  /** True when the thing being labelled is itself a live run. */
  live?: boolean;
}) {
  if (compact) {
    return live ? (
      <span className="live-tag">Live agent</span>
    ) : (
      <span className="simtag">Simulated</span>
    );
  }

  const roles = (runtime?.archetypes ?? [])
    .map((key) => ARCHETYPES[key as AgentArchetype]?.title ?? key)
    .join(', ');

  return (
    <div className="banner">
      <span aria-hidden="true" style={{ fontSize: 14 }}>
        ℹ️
      </span>
      {runtime?.available ? (
        <span>
          <b>{roles}</b> can be run for real on {runtime.model} — use <b>Run for real</b> on a task.
          Everyone else is <b>simulated</b>: their progress, walking and deliveries come from a local
          state machine, and no model is called.
        </span>
      ) : (
        <span>
          Every agent here is <b>simulated</b>. Progress, walking, approvals and deliveries come from
          a local state machine — no AI model is called and no real work is performed.
          {runtime && !runtime.credentialsConfigured && (
            <> Set <span className="mono">ANTHROPIC_API_KEY</span> to run the Researcher for real.</>
          )}
        </span>
      )}
    </div>
  );
}

export function AgentLink({ agentId, children }: { agentId: string; children: React.ReactNode }) {
  return (
    <Link to={`/agents/${agentId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      {children}
    </Link>
  );
}
