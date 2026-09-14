import { memo } from 'react';
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
  /** Architecture style from the island's biome. */
  arch: string;
  /** Delivered crates stacked at the depot. */
  crates: number;
  /** True while an agent is working here — lights come on, machines turn. */
  active: boolean;
  /** True while an agent is waiting here for your decision. */
  needsAttention: boolean;
  selected: boolean;
  onSelect?: (key: PlotKey) => void;
}

/**
 * One place on an island.
 *
 * Each plot is drawn to say what happens there: the workbench has a lit window
 * and a turning gear, the approval post raises a flag when someone is waiting,
 * and the depot stacks one crate per delivery.
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
  selected,
  onSelect,
}: BuildingProps) {
  const info = PLOTS[plotKey];
  const p = iso(info.cell.c, info.cell.r, tw, th);

  const W = plotKey === 'depot' ? 38 : 34;
  const DX = 15;
  const DY = 7.5;
  const H: Record<PlotKey, number> = {
    workbench: 46,
    approval: 0,
    depot: 36,
    rest: 0,
    gate: 0,
  };
  const h = H[plotKey];

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

  let art: React.ReactNode = null;

  if (plotKey === 'workbench') {
    art = (
      <>
        {shell}
        {arch === 'cottage' || arch === 'classical' ? gable : flatRoof}
        {window_(-W / 2 + 5, -h + 11, 20, 11)}
        {door}
        {/* A gear that only turns while work is actually happening. */}
        <g transform={`translate(${-W / 2 - 8},${-h + 6})`}>
          <circle r="6" fill={roof2} />
          <circle r="2.4" fill={wall} />
          {[0, 1, 2, 3].map((i) => (
            <rect
              key={i}
              x={-1.4}
              y={-8}
              width="2.8"
              height="3.2"
              fill={roof2}
              transform={`rotate(${i * 45})`}
            />
          ))}
          {active && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0"
              to="360"
              dur="9s"
              repeatCount="indefinite"
              additive="sum"
            />
          )}
        </g>
        {/* Chimney smoke, while the lights are on. */}
        {active && !mini && (
          <g>
            <rect x={W / 2 - 13} y={-h - DY - 20} width="7" height="17" fill={shade} />
            <circle cx={W / 2 - 9.5} cy={-h - DY - 26} r="5" fill="#e8e2d6" opacity="0.5">
              <animate
                attributeName="cy"
                values={`${-h - DY - 26};${-h - DY - 40}`}
                dur="4.5s"
                repeatCount="indefinite"
              />
              <animate attributeName="opacity" values=".5;0" dur="4.5s" repeatCount="indefinite" />
              <animate attributeName="r" values="3;8" dur="4.5s" repeatCount="indefinite" />
            </circle>
          </g>
        )}
      </>
    );
  } else if (plotKey === 'approval') {
    // A signpost. Its flag is raised only when something is waiting on you.
    art = (
      <>
        <ellipse cx="0" cy="0" rx="15" ry="7.5" fill={mix(pal.shore, pal.wood, 0.25)} />
        <rect x={-2.2} y={-34} width="4.4" height="34" rx="2" fill={pal.wood} />
        <rect x={-14} y={-30} width="28" height="13" rx="2" fill={pal.wall} stroke={pal.wood} strokeWidth="1.8" />
        <rect x={-10} y={-26.5} width="14" height="2.2" rx="1.1" fill={pal.wood} opacity="0.5" />
        <rect x={-10} y={-22.5} width="9" height="2.2" rx="1.1" fill={pal.wood} opacity="0.35" />
        {needsAttention && (
          <g transform="translate(2,-40)">
            <line x1="0" y1="0" x2="0" y2="8" stroke={pal.metal} strokeWidth="1.6" />
            <path d="M 0,0 L 15,4 L 0,8 Z" fill="var(--warn)">
              <animateTransform
                attributeName="transform"
                type="scale"
                values="1 1;.8 1;1 1"
                dur="2.4s"
                repeatCount="indefinite"
                additive="sum"
              />
            </path>
          </g>
        )}
      </>
    );
  } else if (plotKey === 'depot') {
    art = (
      <>
        {shell}
        {flatRoof}
        <rect x={-11} y={-21} width="22" height="21" rx="1.5" fill={shade} />
        {[0, 1, 2, 3].map((i) => (
          <line
            key={i}
            x1={-11}
            y1={-18 + i * 5}
            x2="11"
            y2={-18 + i * 5}
            stroke={darken(shade, 0.12)}
            strokeWidth="1.2"
          />
        ))}
        {window_(W / 2 - 10, -h + 9, 7, 7)}
        {/* One crate per delivery, stacked outside where you can count them. */}
        {Array.from({ length: Math.min(12, crates) }).map((_, i) => {
          const col = i % 4;
          const row = Math.floor(i / 4);
          return (
            <g
              key={i}
              transform={`translate(${W / 2 + DX - 2 + col * 4 - row * 4},${2 - row * 9 + col * 4.5})`}
            >
              <rect x={-6} y={-9} width="12" height="9" rx="1.2" fill="#d6a469" stroke="#a87a46" strokeWidth="1" />
              <line x1={-6} y1={-4.5} x2="6" y2={-4.5} stroke="#a87a46" strokeWidth="1" />
            </g>
          );
        })}
      </>
    );
  } else if (plotKey === 'rest') {
    art = (
      <>
        <ellipse cx="0" cy="0" rx="26" ry="13" fill={mix(pal.shore, pal.shoreSide, 0.3)} />
        <ellipse cx="0" cy="0" rx="17" ry="8" fill={mix(pal.shore, pal.wood, 0.18)} opacity="0.7" />
        {[-1, 1].map((i) => (
          <g key={i} transform={`translate(${i * 19},${i * 5})`}>
            <rect x={-9} y={-3.5} width="18" height="4" rx="2" fill={pal.wood} />
            <rect x={-9} y={-3.5} width="18" height="1.6" rx="0.8" fill={lighten(pal.wood, 0.18)} />
          </g>
        ))}
        <ellipse cx="0" cy={-2} rx="9" ry="4.5" fill={pal.rockMid} />
        <path d="M -4,-5 Q 0,-20 4,-5 Q 0,-9 -4,-5 Z" fill="#f2913f">
          <animateTransform
            attributeName="transform"
            type="scale"
            values="1 1;1 1.25;1 .92;1 1"
            dur="1.6s"
            repeatCount="indefinite"
            additive="sum"
          />
        </path>
        <path d="M -2.2,-5 Q 0,-14 2.2,-5 Z" fill="#ffd36b">
          <animate attributeName="opacity" values=".9;.55;.9" dur="1.1s" repeatCount="indefinite" />
        </path>
      </>
    );
  } else {
    // Gate — the way on and off the island.
    art = (
      <>
        <ellipse cx="0" cy="0" rx="18" ry="9" fill={mix(pal.shore, pal.wood, 0.2)} />
        <rect x={-15} y={-26} width="4.5" height="26" rx="1.5" fill={pal.roof2} />
        <rect x={10.5} y={-26} width="4.5" height="26" rx="1.5" fill={pal.roof2} />
        <rect x={-19} y={-31} width="38" height="4.5" rx="2" fill={pal.roof} />
        <rect x={-16} y={-23} width="32" height="3" rx="1.5" fill={pal.roof} />
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
        <ellipse
          cx={(DX / 2) * sc}
          cy={5 * sc}
          rx={(W / 2 + DX + 6) * sc}
          ry={11 * sc}
          fill={pal.glow}
          opacity="0.25"
        >
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
