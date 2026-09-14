import { Link } from 'react-router-dom';
import {
  BOT_PROFILES,
  STATUS_LABEL,
  STATUS_TONE,
  type ActivityEvent,
  type ActivityKind,
  type BotKey,
  type BotStatus,
  type TaskStatus,
} from '@ai-islands/shared';

/** A status as a coloured pill. The one place a status becomes a colour. */
export function StatusPill({ status }: { status: BotStatus | TaskStatus }) {
  return (
    <span className={`pill tone-${STATUS_TONE[status]}`}>
      <i aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Avatar({ botKey, size = 38 }: { botKey: BotKey; size?: number }) {
  const profile = BOT_PROFILES[botKey];
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

export const logStyle = (kind: ActivityKind) => LOG_STYLE[kind] ?? LOG_STYLE.system!;

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
        const style = logStyle(event.kind);
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
                <time dateTime={new Date(event.at).toISOString()}>{timeAgo(event.at, now)}</time>
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The banner that says, plainly, that no AI model is being called. */
export function SimulatedNotice({ compact = false }: { compact?: boolean }) {
  if (compact) return <span className="simtag">Simulated</span>;
  return (
    <div className="banner">
      <span aria-hidden="true" style={{ fontSize: 14 }}>
        ℹ️
      </span>
      <span>
        Every agent here is <b>simulated</b>. Progress, walking, approvals and deliveries come from a
        local state machine — no AI model is called and no real work is performed.
      </span>
    </div>
  );
}

export function BotLink({ botId, children }: { botId: string; children: React.ReactNode }) {
  return (
    <Link to={`/bots/${botId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      {children}
    </Link>
  );
}
