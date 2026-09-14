import { memo, type ReactNode } from 'react';
import {
  PLOTS,
  darken,
  iso,
  lighten,
  mix,
  type BiomePalette,
  type PlotKey,
} from '@ai-islands/shared';
import { Shadow, type SceneScale } from './Terrain.js';

interface BuildingProps extends SceneScale {
  plotKey: PlotKey;
  pal: BiomePalette;
  /** Architecture style from the project's biome. */
  arch: string;
  /** Delivered crates stacked at the depot. */
  crates: number;
  /** Work in progress here — lights come on, machines turn. */
  active: boolean;
  /** Someone is waiting here for your decision. */
  needsAttention: boolean;
  /** How many tasks are waiting on the board for this building. */
  backlog: number;
  selected: boolean;
  onSelect?: (key: PlotKey) => void;
}

/** Roof height per building. Zero means it is not a walled structure. */
const HEIGHTS: Record<PlotKey, number> = {
  hq: 52,
  library: 42,
  workshop: 36,
  studio: 40,
  data: 38,
  rest: 0,
  gate: 0,
  depot: 34,
};

/**
 * One place on a project's island.
 *
 * Each building is drawn to say what happens there: the library has a reading
 * arch, the workshop a turning gear, the studio a projection screen, the data
 * workshop a live bar chart, and the depot stacks one crate per delivery.
 */
export const Building = memo(function Building({
  plotKey,
  pal,
  arch,
  tw,
  th,
  sc,
  mini,
  crates,
  active,
  needsAttention,
  backlog,
  selected,
  onSelect,
}: BuildingProps) {
  const info = PLOTS[plotKey];
  const p = iso(info.cell.c, info.cell.r, tw, th);

  const W = plotKey === 'hq' ? 40 : 34;
  const DX = 15;
  const DY = 7.5;
  const h = HEIGHTS[plotKey];

  const { wall, wallShade: shade, roof, roof2 } = pal;
  const glow = active ? pal.glow : mix(pal.glow, pal.wallShade, 0.55);

  const window_ = (x: number, y: number, w = 8, ht = 9) => (
    <g>
      <rect x={x} y={y} width={w} height={ht} rx="1.6" fill={glow} />
      {active && (
        <rect x={x} y={y} width={w} height={ht} rx="1.6" fill={pal.glow} opacity="0.6">
          <animate attributeName="opacity" values=".25;.7;.25" dur="4s" repeatCount="indefinite" />
        </rect>
      )}
    </g>
  );

  const shell = (
    <>
      <polygon points={`${-W / 2},0 ${W / 2},0 ${W / 2},${-h} ${-W / 2},${-h}`} fill={wall} />
      <polygon
        points={`${W / 2},0 ${W / 2 + DX},${-DY} ${W / 2 + DX},${-DY - h} ${W / 2},${-h}`}
        fill={shade}
      />
      <polygon
        points={`${-W / 2},${-h} ${W / 2},${-h} ${W / 2 + DX},${-h - DY} ${-W / 2 + DX},${-h - DY}`}
        fill={lighten(shade, 0.16)}
      />
    </>
  );

  const door = (
    <g>
      <rect x={-5.5} y={-17} width="11" height="17" rx="1.5" fill={pal.wood} />
      <rect x={-4} y={-15} width="8" height="15" rx="1" fill={darken(pal.wood, 0.2)} />
      <circle cx="2.6" cy={-8} r="0.9" fill={pal.metal} />
    </g>
  );

  const gable = (
    <g>
      <polygon
        points={`${-W / 2 - 4},${-h} ${W / 2 + 4},${-h} ${W / 2 + 4 + DX},${-h - DY} ${-W / 2 - 4 + DX},${-h - DY}`}
        fill={roof}
      />
      <polygon
        points={`${-W / 2 - 4},${-h} ${-W / 2 - 4 + DX},${-h - DY} ${DX / 2},${-h - DY - 15} -3,${-h - 2}`}
        fill={roof}
      />
      <polygon
        points={`${W / 2 + 4},${-h} ${W / 2 + 4 + DX},${-h - DY} ${DX / 2},${-h - DY - 15}`}
        fill={roof2}
      />
    </g>
  );

  const flatRoof = (
    <g>
      <polygon
        points={`${-W / 2 - 3},${-h} ${W / 2 + 3},${-h} ${W / 2 + 3 + DX},${-h - DY} ${-W / 2 - 3 + DX},${-h - DY}`}
        fill={roof}
      />
      <polygon
        points={`${-W / 2 - 3},${-h} ${W / 2 + 3},${-h} ${W / 2 + 3},${-h - 3} ${-W / 2 - 3},${-h - 3}`}
        fill={darken(roof, 0.12)}
      />
    </g>
  );

  const pitched = arch === 'cottage' || arch === 'classical' ? gable : flatRoof;

  let art: ReactNode = null;

  if (plotKey === 'hq') {
    // The seat of the project: a clock, a flag, and where approvals wait.
    art = (
      <>
        {shell}
        {pitched}
        {window_(-W / 2 + 5, -h + 12)}
        {window_(-W / 2 + 17, -h + 12)}
        {window_(-W / 2 + 5, -h + 27)}
        {window_(-W / 2 + 17, -h + 27)}
        {door}
        <circle cx={W / 2 + DX / 2} cy={-h + 14} r="5.5" fill={wall} stroke={roof2} strokeWidth="1.4" />
        <line x1={W / 2 + DX / 2} y1={-h + 14} x2={W / 2 + DX / 2} y2={-h + 10.5} stroke={roof2} strokeWidth="1.2" />
        <line x1={W / 2 + DX / 2} y1={-h + 14} x2={W / 2 + DX / 2 + 3} y2={-h + 15} stroke={roof2} strokeWidth="1.2" />
        <line x1={DX / 2} y1={-h - DY} x2={DX / 2} y2={-h - DY - 26} stroke={pal.metal} strokeWidth="1.8" />
        <path
          d={`M ${DX / 2},${-h - DY - 26} L ${DX / 2 + 16},${-h - DY - 21} L ${DX / 2},${-h - DY - 16} Z`}
          fill={needsAttention ? 'var(--warn)' : roof}
        >
          <animateTransform
            attributeName="transform"
            type="scale"
            values="1 1;.8 1;1 1"
            dur={needsAttention ? '2s' : '3.2s'}
            repeatCount="indefinite"
            additive="sum"
          />
        </path>
        <polygon points="-9,0 9,0 12,4 -12,4" fill={pal.wallShade} />
      </>
    );
  } else if (plotKey === 'library') {
    art = (
      <>
        {shell}
        {pitched}
        {arch === 'classical' && (
          <g>
            <rect x={-W / 2 + 2} y={-h} width="4" height={h} fill={lighten(wall, 0.3)} />
            <rect x={W / 2 - 6} y={-h} width="4" height={h} fill={lighten(wall, 0.3)} />
          </g>
        )}
        <path d={`M -11,0 L -11,-14 a 11 11 0 0 1 22 0 L 11,0 Z`} fill={glow} />
        <line x1="0" y1={-22} x2="0" y2="0" stroke={pal.wood} strokeWidth="1.4" />
        {window_(-W / 2 + 4, -h + 10, 7, 8)}
        {window_(W / 2 - 11, -h + 10, 7, 8)}
        <g transform={`translate(${W / 2 + DX - 4},-3)`}>
          <rect x={-8} y={-4} width="16" height="4" rx="1" fill={roof} />
          <rect x={-6.5} y={-8} width="13" height="4" rx="1" fill={roof2} />
          <rect x={-5} y={-12} width="10" height="4" rx="1" fill={pal.wood} />
        </g>
      </>
    );
  } else if (plotKey === 'workshop') {
    art = (
      <>
        {shell}
        <polygon
          points={`${-W / 2 - 4},${-h} ${W / 2 + 4 + DX},${-h - DY + 4} ${W / 2 + 4 + DX},${-h - DY - 5} ${-W / 2 - 4},${-h - 9}`}
          fill={roof}
        />
        {window_(-W / 2 + 5, -h + 11, 20, 11)}
        {door}
        {/* A gear that only turns while work is actually happening. */}
        <g transform={`translate(${-W / 2 - 8},${-h + 6})`}>
          <circle r="6" fill={roof2} />
          <circle r="2.4" fill={wall} />
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={-1.4} y={-8} width="2.8" height="3.2" fill={roof2} transform={`rotate(${i * 45})`} />
          ))}
          {active && (
            <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="9s" repeatCount="indefinite" additive="sum" />
          )}
        </g>
        {active && !mini && (
          <g>
            <rect x={W / 2 - 13} y={-h - DY - 22} width="8" height="19" fill={shade} />
            <circle cx={W / 2 - 9} cy={-h - DY - 28} r="5" fill="#e8e2d6" opacity="0.5">
              <animate attributeName="cy" values={`${-h - DY - 28};${-h - DY - 42}`} dur="4.5s" repeatCount="indefinite" />
              <animate attributeName="opacity" values=".5;0" dur="4.5s" repeatCount="indefinite" />
              <animate attributeName="r" values="3;8" dur="4.5s" repeatCount="indefinite" />
            </circle>
          </g>
        )}
      </>
    );
  } else if (plotKey === 'studio') {
    art = (
      <>
        {shell}
        {pitched}
        {/* A projection screen showing a slide being built. */}
        <rect x={-W / 2 + 4} y={-h + 8} width="26" height="18" rx="2" fill={wall} stroke={roof2} strokeWidth="1.4" />
        <rect x={-W / 2 + 7} y={-h + 12} width="15" height="2.4" rx="1.2" fill={roof}>
          {active && <animate attributeName="width" values="4;15;4" dur="5s" repeatCount="indefinite" />}
        </rect>
        <rect x={-W / 2 + 7} y={-h + 17} width="20" height="1.8" rx="0.9" fill={shade} />
        <rect x={-W / 2 + 7} y={-h + 21} width="11" height="1.8" rx="0.9" fill={shade} />
        {door}
        <g transform={`translate(${W / 2 + DX - 3},-2)`}>
          <line x1="0" y1="0" x2="0" y2={-14} stroke={pal.metal} strokeWidth="1.6" />
          <path d="M -4,-14 L 4,-14 L 6,-21 L -6,-21 Z" fill={pal.metal} />
          <ellipse cx="0" cy={-21} rx="6" ry="2" fill={pal.glow} opacity={active ? 0.9 : 0.35} />
        </g>
      </>
    );
  } else if (plotKey === 'data') {
    art = (
      <>
        {shell}
        {pitched}
        {/* A live bar chart on the wall. */}
        <rect x={-W / 2 + 5} y={-h + 9} width="24" height="18" rx="2" fill={wall} stroke={roof2} strokeWidth="1.3" />
        {[6, 11, 8, 14].map((bh, i) => (
          <rect
            key={i}
            x={-W / 2 + 8 + i * 5.5}
            y={-h + 25 - bh}
            width="3.6"
            height={bh}
            rx="1"
            fill={i === 3 ? roof : roof2}
          >
            {active && (
              <>
                <animate attributeName="height" values={`${bh};${bh * 0.55};${bh}`} dur={`${3 + i}s`} repeatCount="indefinite" />
                <animate attributeName="y" values={`${-h + 25 - bh};${-h + 25 - bh * 0.55};${-h + 25 - bh}`} dur={`${3 + i}s`} repeatCount="indefinite" />
              </>
            )}
          </rect>
        ))}
        {door}
        <g transform={`translate(${-W / 2 - 9},-2)`}>
          <rect x={-6} y={-4} width="12" height="4" rx="1" fill={roof2} />
          <rect x={-5} y={-8} width="10" height="4" rx="1" fill={roof} />
        </g>
      </>
    );
  } else if (plotKey === 'depot') {
    art = (
      <>
        {shell}
        {flatRoof}
        <rect x={-11} y={-21} width="22" height="21" rx="1.5" fill={shade} />
        {[0, 1, 2, 3].map((i) => (
          <line key={i} x1={-11} y1={-18 + i * 5} x2="11" y2={-18 + i * 5} stroke={darken(shade, 0.12)} strokeWidth="1.2" />
        ))}
        {window_(W / 2 - 10, -h + 9, 7, 7)}
        {/* One crate per delivery, stacked outside where you can count them. */}
        {Array.from({ length: Math.min(12, crates) }).map((_, i) => {
          const col = i % 4;
          const row = Math.floor(i / 4);
          return (
            <g key={i} transform={`translate(${W / 2 + DX - 2 + col * 4 - row * 4},${2 - row * 9 + col * 4.5})`}>
              <rect x={-6} y={-9} width="12" height="9" rx="1.2" fill="#d6a469" stroke="#a87a46" strokeWidth="1" />
              <line x1={-6} y1={-4.5} x2="6" y2={-4.5} stroke="#a87a46" strokeWidth="1" />
            </g>
          );
        })}
      </>
    );
  } else if (plotKey === 'rest') {
    // The meeting circle: a fire, benches, and the waiting work pinned nearby.
    art = (
      <>
        <ellipse cx="0" cy="0" rx={tw / 2 - 7} ry={th / 2 - 3.5} fill={mix(pal.shore, pal.shoreSide, 0.3)} />
        <ellipse cx="0" cy="0" rx={tw / 2 - 15} ry={th / 2 - 8} fill={mix(pal.shore, pal.wood, 0.18)} opacity="0.7" />
        {[-1, 1].map((i) => (
          <g key={i} transform={`translate(${i * 20},${i * 5})`}>
            <rect x={-9} y={-3.5} width="18" height="4" rx="2" fill={pal.wood} />
            <rect x={-9} y={-3.5} width="18" height="1.6" rx="0.8" fill={lighten(pal.wood, 0.18)} />
          </g>
        ))}
        <ellipse cx="0" cy={-2} rx="9" ry="4.5" fill={pal.rockMid} />
        <ellipse cx="0" cy={-4} rx="6.5" ry="3" fill={darken(pal.rockDeep, 0.1)} />
        <path d="M -4,-5 Q 0,-20 4,-5 Q 0,-9 -4,-5 Z" fill="#f2913f">
          <animateTransform attributeName="transform" type="scale" values="1 1;1 1.25;1 .92;1 1" dur="1.6s" repeatCount="indefinite" additive="sum" />
        </path>
        <path d="M -2.2,-5 Q 0,-14 2.2,-5 Z" fill="#ffd36b">
          <animate attributeName="opacity" values=".9;.55;.9" dur="1.1s" repeatCount="indefinite" />
        </path>
        {/* Waiting work, as notes on a board beside the fire. */}
        {!mini && backlog > 0 && (
          <g transform="translate(26,-4)">
            <rect x={-1.8} y={-12} width="3.6" height="12" rx="1.2" fill={pal.wood} />
            <rect x={-14} y={-32} width="28" height="21" rx="2.5" fill={mix(pal.shore, pal.wood, 0.35)} stroke={pal.wood} strokeWidth="2" />
            {Array.from({ length: Math.min(6, backlog) }).map((_, i) => (
              <rect
                key={i}
                x={-10 + (i % 3) * 7}
                y={-28 + Math.floor(i / 3) * 7.5}
                width="5.5"
                height="5.5"
                rx="1"
                fill={pal.flower[i % pal.flower.length]!}
                opacity="0.95"
              />
            ))}
          </g>
        )}
      </>
    );
  } else {
    // Gate — the way on and off the island.
    art = (
      <>
        <ellipse cx="0" cy="0" rx="18" ry="9" fill={mix(pal.shore, pal.wood, 0.2)} />
        <rect x={-15} y={-26} width="4.5" height="26" rx="1.5" fill={roof2} />
        <rect x={10.5} y={-26} width="4.5" height="26" rx="1.5" fill={roof2} />
        <rect x={-19} y={-31} width="38" height="4.5" rx="2" fill={roof} />
        <rect x={-16} y={-23} width="32" height="3" rx="1.5" fill={roof} />
      </>
    );
  }

  const label = info.label;
  const lw = Math.max(58, label.length * 5.9 + 30);

  return (
    <g
      transform={`translate(${p.x},${p.y})`}
      onClick={
        onSelect
          ? (e) => {
              e.stopPropagation();
              onSelect(plotKey);
            }
          : undefined
      }
      style={{ cursor: onSelect ? 'pointer' : 'default' }}
    >
      {!mini && <Shadow rx={(W / 2 + DX) * sc} ry={8.5 * sc} o={0.2} cy={4 * sc} />}
      {active && !mini && (
        <ellipse cx={(DX / 2) * sc} cy={5 * sc} rx={(W / 2 + DX + 6) * sc} ry={11 * sc} fill={pal.glow} opacity="0.25">
          <animate attributeName="opacity" values=".12;.3;.12" dur="4s" repeatCount="indefinite" />
        </ellipse>
      )}
      <g transform={`scale(${sc})`}>{art}</g>
      {selected && (
        <ellipse
          cx={(DX / 2) * sc}
          cy={5 * sc}
          rx={(W / 2 + DX + 10) * sc}
          ry={13 * sc}
          fill="none"
          stroke={pal.roof}
          strokeWidth="2.5"
          strokeDasharray="6 5"
        />
      )}
      {!mini && (
        <g transform={`translate(${(DX / 2) * sc},${13 * sc})`} style={{ pointerEvents: 'none' }}>
          <rect
            x={-lw / 2}
            y="0"
            width={lw}
            height="16"
            rx="8"
            fill="var(--panel)"
            stroke={selected ? pal.roof : 'var(--line)'}
            strokeWidth={selected ? 1.6 : 1}
            opacity="0.96"
          />
          <text x={-lw / 2 + 9} y="8.6" dominantBaseline="central" fontSize="8.5">
            {info.icon}
          </text>
          <text
            x={-lw / 2 + 21}
            y="8.6"
            dominantBaseline="central"
            fontSize="9.2"
            fontWeight="700"
            fill="var(--ink-2)"
            fontFamily="var(--body)"
          >
            {label}
          </text>
        </g>
      )}
    </g>
  );
});
