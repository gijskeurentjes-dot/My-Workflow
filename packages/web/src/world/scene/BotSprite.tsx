import { STATUS_LABEL, STATUS_TONE, TILE_W, iso } from '@ai-islands/shared';
import type { BotDisplay } from '../selectors.js';
import { Shadow, type SceneScale } from './Terrain.js';

interface BotSpriteProps extends SceneScale {
  display: BotDisplay;
  /** Milliseconds, used to drive the walk cycle and breathing. */
  clock: number;
  selected: boolean;
  onSelect?: (botId: string) => void;
}

/** The tool each role carries, and the silhouette that distinguishes it. */
function RoleRig({
  botKey,
  color,
  active,
  workPhase,
}: {
  botKey: string;
  color: { base: string; dark: string; light: string };
  active: boolean;
  workPhase: number | null;
}) {
  // While working, the tool in the agent's hand actually moves.
  const tool = workPhase === null ? '' : ` rotate(${(Math.sin(workPhase) * 9).toFixed(1)})`;

  if (botKey === 'atlas') {
    return (
      <g>
        <rect x={-8.5} y={-33} width="17" height="13" rx="5" fill={color.light} />
        <path
          d="M -8.5,-31 L 8.5,-31 L 8.5,-33 A 5 5 0 0 0 3.5,-33 L -3.5,-33 A 5 5 0 0 0 -8.5,-33 Z"
          fill={color.dark}
        />
        <g transform={`translate(10,-16)${tool}`}>
          <rect x={-4} y={-6} width="8" height="10" rx="1" fill="#f7f3e8" stroke={color.dark} strokeWidth="1" />
          <line x1={-2} y1={-3} x2="2" y2={-3} stroke={color.dark} strokeWidth="1" />
          <line x1={-2} y1="0" x2="2" y2="0" stroke={color.dark} strokeWidth="1" />
        </g>
      </g>
    );
  }

  if (botKey === 'nova') {
    return (
      <g>
        <circle cx="0" cy={-26.5} r="9" fill={color.light} />
        <g transform={`translate(11,-20)${tool}`}>
          <circle r="4.2" fill="none" stroke={color.dark} strokeWidth="1.8" />
          <circle r="3.2" fill="#bfe9ff" opacity="0.8" />
          <line x1="3" y1="3" x2="6.5" y2="6.5" stroke={color.dark} strokeWidth="1.8" strokeLinecap="round" />
        </g>
      </g>
    );
  }

  if (botKey === 'forge') {
    return (
      <g>
        <rect x={-9} y={-33.5} width="18" height="14" rx="3.5" fill={color.light} />
        <rect x={-9.5} y={-30} width="19" height="5.5" rx="2.5" fill="#2b2f3d" />
        <g transform={`translate(0,-13)${tool}`}>
          <rect x={-8} y={-1.5} width="16" height="3" rx="1" fill={color.dark} />
          <path d="M -7,-1.5 L -5,-8 L 5,-8 L 7,-1.5 Z" fill="#2b2f3d" />
          <rect x={-4.6} y={-7} width="9.2" height="4.6" fill="#8ff0d6" opacity={active ? 0.95 : 0.5}>
            {active && (
              <animate attributeName="opacity" values=".5;.95;.5" dur="1.8s" repeatCount="indefinite" />
            )}
          </rect>
        </g>
      </g>
    );
  }

  if (botKey === 'slidebuilder') {
    return (
      <g>
        <rect x={-8.5} y={-33} width="17" height="13.5" rx="6" fill={color.light} />
        <g transform={`translate(11,-21)${tool}`}>
          <rect x={-5} y={-7} width="11" height="9" rx="1" fill="#f7f3e8" stroke={color.dark} strokeWidth="1" />
          <rect x={-3} y={-5} width="7" height="1.6" fill={color.base} />
          <rect x={-3} y={-2.4} width="5" height="1.4" fill={color.dark} opacity="0.5" />
          <line x1="6" y1="2" x2="9" y2="5" stroke={color.dark} strokeWidth="1.6" strokeLinecap="round" />
        </g>
      </g>
    );
  }

  // Excel Expert
  return (
    <g>
      <rect x={-8.5} y={-33} width="17" height="13" rx="4" fill={color.light} />
      <rect x={-6} y={-31} width="12" height="4" rx="1" fill="#2b2f3d" opacity="0.75" />
      <g transform={`translate(10,-17)${tool}`}>
        <rect x={-4.5} y={-6} width="9" height="11" rx="1.2" fill="#f7f3e8" stroke={color.dark} strokeWidth="1" />
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <circle cx={-2.2} cy={-2 + i * 2.6} r="0.8" fill={color.dark} />
            <circle cx="0.4" cy={-2 + i * 2.6} r="0.8" fill={color.dark} />
            <circle cx="2.8" cy={-2 + i * 2.6} r="0.8" fill={color.base} />
          </g>
        ))}
      </g>
    </g>
  );
}

/**
 * One agent, standing on its island.
 *
 * The sprite is a real SVG node with a role, a label and a title, so it is
 * reachable by keyboard and announced by a screen reader — the animation is
 * the presentation, never the only way to learn what a bot is doing.
 */
export function BotSprite({ display, clock, tw, th, sc, mini, selected, onSelect }: BotSpriteProps) {
  const { bot, profile, position, facing, movement, carrying, task, doing } = display;
  const p = iso(position.c, position.r, tw, th);

  const walking = movement === 'walking';
  const working = movement === 'working';

  // Everything below is derived from the shared clock, so no per-bot timers.
  const seconds = clock / 1000;
  // Offset by a stable hash of the id, so five bots do not breathe in lockstep.
  const phase = (bot.id.charCodeAt(4) % 10) * 0.7;
  const gait = walking ? seconds * 9.5 + phase : 0;
  const swing = walking ? Math.sin(gait) : 0;
  const bob = walking ? Math.abs(Math.sin(gait)) * -2.4 : Math.sin(seconds * 1.6 + phase) * -0.9;
  const workPhase = working ? seconds * 3.4 + phase : null;
  const shake = bot.status === 'failed' ? Math.sin(seconds * 6.4 + phase) * 0.9 : 0;
  const asleep = bot.status === 'paused' || (bot.status === 'idle' && !walking);
  // A blink is a short dip once every few seconds.
  const blinking = !asleep && Math.sin(seconds * 1.3 + phase) > 0.985;

  const statusColor = `var(--${STATUS_TONE[bot.status]})`;

  let bubble: { text: string; tint: string } | null = null;
  if (!mini) {
    if (bot.status === 'waiting_approval') bubble = { text: '!', tint: 'var(--warn)' };
    else if (bot.status === 'failed') bubble = { text: '✕', tint: 'var(--bad)' };
    else if (bot.status === 'completed') bubble = { text: '✓', tint: 'var(--violet)' };
    else if (task?.status === 'delivering') bubble = { text: '\u{1F4E6}', tint: 'var(--violet)' };
    else if (asleep) bubble = { text: 'z', tint: 'var(--info)' };
    else if (working) bubble = { text: profile.icon, tint: 'var(--ok)' };
  }

  const progress = task ? Math.min(100, task.progress) : 0;
  const showBar =
    bot.status === 'working' || bot.status === 'paused' || bot.status === 'failed';
  const chipW = Math.max(56, bot.name.length * 5.9 + 30);

  const label = `${bot.name}, ${profile.title}. ${STATUS_LABEL[bot.status]}. ${doing}`;

  return (
    <g
      transform={`translate(${p.x},${p.y})`}
      role={onSelect ? 'button' : 'img'}
      tabIndex={onSelect && !mini ? 0 : undefined}
      aria-label={label}
      onClick={
        onSelect
          ? (e) => {
              e.stopPropagation();
              onSelect(bot.id);
            }
          : undefined
      }
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onSelect(bot.id);
              }
            }
          : undefined
      }
      style={{ cursor: onSelect ? 'pointer' : 'default' }}
    >
      <title>{label}</title>

      {/* Status reads from the ground up, so it belongs to the world. */}
      {!mini && (
        <ellipse
          cx="0"
          cy={2 * sc}
          rx={15 * sc}
          ry={6 * sc}
          fill={statusColor}
          opacity={selected ? 0.3 : 0.16}
        />
      )}
      {selected && !mini && (
        <ellipse
          cx="0"
          cy={2 * sc}
          rx={17 * sc}
          ry={7 * sc}
          fill="none"
          stroke={profile.color.base}
          strokeWidth={2 * sc}
        >
          <animate attributeName="rx" values={`${16 * sc};${20 * sc};${16 * sc}`} dur="2.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;.35;1" dur="2.2s" repeatCount="indefinite" />
        </ellipse>
      )}
      <Shadow rx={9 * sc} ry={3.4 * sc} o={0.28} cy={2 * sc} />

      <g transform={`translate(${shake * sc},${bob * sc}) scale(${sc * facing},${sc})`}>
        {/* Legs */}
        <g transform={`rotate(${swing * 20},-4,-8)`}>
          <rect x={-5.6} y={-9} width="4" height="9.5" rx="2" fill={profile.color.dark} />
        </g>
        <g transform={`rotate(${-swing * 20},4,-8)`}>
          <rect x={1.6} y={-9} width="4" height="9.5" rx="2" fill={profile.color.dark} />
        </g>

        {/* Body */}
        <rect x={-8.5} y={-22} width="17" height="15" rx="6" fill={profile.color.base} />
        <rect x={-5} y={-18.5} width="10" height="7" rx="2.5" fill={profile.color.light} opacity="0.9" />

        {/* Back arm */}
        <g transform={`rotate(${-swing * 16},-8,-20)`}>
          <rect x={-10.6} y={-20} width="3.4" height="10" rx="1.7" fill={profile.color.dark} />
        </g>

        <RoleRig botKey={bot.key} color={profile.color} active={working} workPhase={workPhase} />

        {/* Ticks of simulated work rising from the desk. */}
        {working && !mini &&
          [0, 1, 2].map((i) => {
            const ph = ((seconds * 0.75 + i * 0.34) % 1);
            return (
              <circle
                key={i}
                cx={9 + i * 2.5}
                cy={-24 - ph * 16}
                r={1.7 - i * 0.2}
                fill={profile.color.base}
                opacity={(1 - ph) * 0.7}
              />
            );
          })}

        {/* Eyes */}
        {blinking || asleep ? (
          <>
            <path d="M -4.2,-26.5 q 1.8,1.6 3.6,0" stroke="#2b2f3d" strokeWidth="1.3" fill="none" strokeLinecap="round" />
            <path d="M 0.6,-26.5 q 1.8,1.6 3.6,0" stroke="#2b2f3d" strokeWidth="1.3" fill="none" strokeLinecap="round" />
          </>
        ) : (
          <>
            <circle cx={-2.4} cy={-26.5} r="1.6" fill={bot.status === 'failed' ? '#ff9a8f' : '#2b2f3d'} />
            <circle cx="2.4" cy={-26.5} r="1.6" fill={bot.status === 'failed' ? '#ff9a8f' : '#2b2f3d'} />
          </>
        )}

        {/* Antenna carrying the status light */}
        <line x1="0" y1={-33} x2="0" y2={-38} stroke={profile.color.dark} strokeWidth="1.5" />
        <circle cx="0" cy={-39.4} r="2.4" fill={statusColor}>
          {working && <animate attributeName="r" values="2.1;3;2.1" dur="1.8s" repeatCount="indefinite" />}
        </circle>

        {carrying && (
          <g transform="translate(10,-13)">
            <rect x={-6.5} y={-7.5} width="13" height="10.5" rx="1.5" fill="#d6a469" stroke="#a87a46" strokeWidth="1" />
            <line x1={-6.5} y1={-2.2} x2="6.5" y2={-2.2} stroke="#a87a46" strokeWidth="1" />
          </g>
        )}
      </g>

      {/* Nameplate */}
      {!mini && (
        <g transform={`translate(0,${-54 * sc}) scale(${sc})`} style={{ pointerEvents: 'none' }}>
          <rect
            x={-chipW / 2}
            y="0"
            width={chipW}
            height="17"
            rx="8.5"
            fill="var(--panel)"
            stroke={selected ? profile.color.base : 'var(--line)'}
            strokeWidth={selected ? 2 : 1}
            opacity="0.97"
          />
          <circle cx={-chipW / 2 + 9} cy="8.5" r="4" fill={profile.color.base} />
          <text
            x={-chipW / 2 + 17}
            y="8.8"
            dominantBaseline="central"
            fontSize="9.3"
            fontWeight="800"
            fill="var(--ink)"
            fontFamily="var(--body)"
          >
            {bot.name}
          </text>
          {showBar && (
            <>
              <rect x={-chipW / 2 + 6} y="13.4" width={chipW - 12} height="2.4" rx="1.2" fill="var(--sunken)" />
              <rect
                x={-chipW / 2 + 6}
                y="13.4"
                width={((chipW - 12) * progress) / 100}
                height="2.4"
                rx="1.2"
                fill={`var(--${STATUS_TONE[bot.status]})`}
              />
            </>
          )}
        </g>
      )}

      {bubble && (
        <g
          transform={`translate(${(chipW / 2 + 9) * sc},${-58 * sc}) scale(${sc})`}
          style={{ pointerEvents: 'none' }}
        >
          <circle r="10" fill="var(--panel)" stroke={bubble.tint} strokeWidth="1.7" />
          <path d="M -3,8 L 1,13 L 3,7 Z" fill="var(--panel)" stroke={bubble.tint} strokeWidth="1.2" />
          <text textAnchor="middle" dominantBaseline="central" fontSize="10" fontWeight="800" fill={bubble.tint}>
            {bubble.text}
          </text>
        </g>
      )}
    </g>
  );
}

export const BOT_FULL_TILE = TILE_W;
