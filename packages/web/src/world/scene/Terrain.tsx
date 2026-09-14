import { memo } from 'react';
import {
  CY,
  ELEV,
  PLOTS,
  ROADS,
  SHORE_R,
  TILE_W,
  cellKey,
  coastPath,
  darken,
  drawOrder,
  generateTerrain,
  hashCell,
  iso,
  lighten,
  mix,
  rimCells,
  type BiomePalette,
} from '@ai-islands/shared';

export interface SceneScale {
  /** Tile width and height at the current zoom. */
  tw: number;
  th: number;
  /** Scale factor relative to the full-size tile. */
  sc: number;
  /** Mini islands skip the expensive detail. */
  mini: boolean;
}

export const Shadow = ({ rx, ry, o = 0.2, cy = 0 }: { rx: number; ry: number; o?: number; cy?: number }) => (
  <ellipse cx="0" cy={cy} rx={rx} ry={ry} fill="#14210d" opacity={o} />
);

/**
 * The island itself: a floating rock with layered terrain, a beach and surf.
 *
 * Pure geometry from a seed — nothing here is stored, so the same island looks
 * identical on every machine and after every reset.
 */
export const Terrain = memo(function Terrain({
  seed,
  pal,
  tw,
  th,
  sc,
  mini,
}: SceneScale & { seed: number; pal: BiomePalette }) {
  const cells = generateTerrain(seed);
  const order = drawOrder(cells);
  const rim = rimCells(cells);
  const base = Math.max(6, th * 0.3);
  const lift = ELEV * sc;

  // The lagoon, traced as a smooth coastline rather than stepped tiles.
  const sea2 = coastPath(seed, SHORE_R + 1.55, tw, th);
  const sea1 = coastPath(seed, SHORE_R + 0.78, tw, th);
  const surf = coastPath(seed, SHORE_R + 0.12, tw, th);
  const cy = CY * th;
  const shrink = (s: number, dy: number) =>
    `translate(0,${dy}) translate(0,${cy}) scale(${s}) translate(0,${-cy})`;

  // Each layer of the keel has to descend faster than it shrinks, or the rock
  // underside reads flat instead of tapering into cloud.
  const halfHeight = (SHORE_R + 1.55) * th * 0.71;
  const keel = (mini ? 96 : 178) * sc;

  return (
    <g>
      <g>
        {Array.from({ length: 14 }).map((_, i) => {
          const t = i / 13;
          const s = Math.max(0.12, 1 - Math.pow(t, 0.78) * 0.9);
          const dy = halfHeight + keel * t - halfHeight * s;
          return (
            <path
              key={`keel${i}`}
              d={sea2}
              transform={shrink(s, dy)}
              fill={mix(pal.rock, pal.rockDeep, Math.pow(t, 0.65))}
              opacity={0.99 - t * 0.22}
            />
          );
        })}

        {/* Stalactites break the silhouette along the front edge. */}
        {rim
          .filter((_, i) => i % 3 === 0)
          .map((t) => {
            const p = iso(t.c, t.r, tw, th);
            if (p.y < CY * th + th) return null;
            const h = hashCell(t.c, t.r, seed);
            const depth = (50 + h * 78) * sc;
            return (
              <polygon
                key={`sp${t.c}_${t.r}`}
                points={`${p.x - tw * 0.46},${p.y + th * 0.4} ${p.x + tw * 0.46},${p.y + th * 0.4} ${p.x + (h - 0.5) * tw * 0.4},${p.y + depth}`}
                fill={h > 0.5 ? pal.rockDeep : darken(pal.rockMid, 0.1)}
                opacity="0.95"
              />
            );
          })}

        {!mini &&
          rim
            .filter((_, i) => i % 7 === 0)
            .map((t) => {
              const p = iso(t.c, t.r, tw, th);
              if (p.y < CY * th) return null;
              const h = hashCell(t.c, t.r, seed + 5);
              return (
                <path
                  key={`vine${t.c}_${t.r}`}
                  d={`M ${p.x},${p.y + th * 0.35} q ${(h - 0.5) * 26 * sc},${34 * sc} ${(h - 0.5) * 12 * sc},${(48 + h * 40) * sc}`}
                  stroke={pal.leaf[0]}
                  strokeWidth={2.4 * sc}
                  fill="none"
                  opacity="0.75"
                  strokeLinecap="round"
                />
              );
            })}
      </g>

      {/* Sea */}
      <g transform={`translate(0,${9 * sc})`}>
        <path d={sea2} fill={pal.waterDeep} />
        <path d={sea1} fill={pal.water} />
        <path d={surf} fill="none" stroke={pal.foam} strokeWidth={5 * sc} opacity="0.55">
          <animate
            attributeName="stroke-width"
            values={`${3.5 * sc};${6.5 * sc};${3.5 * sc}`}
            dur="6s"
            repeatCount="indefinite"
          />
        </path>
      </g>

      {/* Tiles */}
      {order.map((t) => {
        const p = iso(t.c, t.r, tw, th);
        const h = hashCell(t.c, t.r, seed);
        const y = p.y - t.h * lift;
        const faceH = base + t.h * lift;

        let top: string;
        let sideL: string;
        let sideR: string;
        if (t.kind === 'shore') {
          top = mix(pal.shore, pal.shoreSide, h * 0.3);
          sideL = lighten(pal.shoreSide, 0.06);
          sideR = darken(pal.shoreSide, 0.12);
        } else {
          const tone = pal.grass[Math.floor(h * pal.grass.length) % pal.grass.length]!;
          top = mix(tone, pal.sideDark, Math.min(0.2, Math.max(0, (t.d - 4.6) / 7)));
          sideL = lighten(pal.side, 0.05);
          sideR = darken(pal.side, 0.12);
        }

        const dia = `0,${-th / 2} ${tw / 2},0 0,${th / 2} ${-tw / 2},0`;
        // Only draw a cliff face where the ground actually drops away, so flat
        // ground reads as one field instead of a quilt of tiles.
        const lCell = cells.get(cellKey(t.c, t.r + 1));
        const rCell = cells.get(cellKey(t.c + 1, t.r));
        const lDrop = lCell ? (t.h - lCell.h) * lift : faceH;
        const rDrop = rCell ? (t.h - rCell.h) * lift : faceH;

        return (
          <g key={`t${t.c}_${t.r}`} transform={`translate(${p.x},${y})`}>
            {lDrop > 0 && (
              <polygon
                points={`${-tw / 2},0 0,${th / 2} 0,${th / 2 + lDrop} ${-tw / 2},${lDrop}`}
                fill={sideL}
              />
            )}
            {rDrop > 0 && (
              <polygon
                points={`${tw / 2},0 0,${th / 2} 0,${th / 2 + rDrop} ${tw / 2},${rDrop}`}
                fill={sideR}
              />
            )}
            <polygon points={dia} fill={top} />
            {t.kind === 'shore' && t.d > 6.55 && (
              <polygon points={dia} fill={pal.water} opacity="0.16" />
            )}
            {!mini && t.kind === 'grass' && h > 0.8 && (
              <g
                opacity="0.55"
                stroke={pal.sideDark}
                strokeWidth={1.4 * sc}
                strokeLinecap="round"
                fill="none"
              >
                <path d={`M ${-5 * sc},${2 * sc} q ${1 * sc},${-5 * sc} ${3 * sc},${-6 * sc}`} />
                <path d={`M 0,${3 * sc} q ${1 * sc},${-5 * sc} ${-2 * sc},${-7 * sc}`} />
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
});

/** The walkable streets, drawn as packed earth inset inside each tile. */
export const Roads = memo(function Roads({
  seed,
  pal,
  tw,
  th,
  sc,
}: SceneScale & { seed: number; pal: BiomePalette }) {
  const cells = generateTerrain(seed);
  const road = [...ROADS]
    .map((k) => {
      const [c, r] = k.split(':').map(Number) as [number, number];
      return { c, r };
    })
    .filter((t) => cells.get(cellKey(t.c, t.r))?.kind === 'grass')
    .sort((a, b) => a.c + a.r - (b.c + b.r));

  const roadCol = mix(pal.shore, pal.wood, 0.34);
  const inset = 2.6 * sc;

  return (
    <g>
      {road.map((t) => {
        const p = iso(t.c, t.r, tw, th);
        return (
          <g key={`rd${t.c}_${t.r}`} transform={`translate(${p.x},${p.y - 1})`}>
            <polygon
              points={`0,${-th / 2 + inset / 2} ${tw / 2 - inset},0 0,${th / 2 - inset / 2} ${-tw / 2 + inset},0`}
              fill={roadCol}
            />
          </g>
        );
      })}
    </g>
  );
});

function TreeArt({ kind, pal, h }: { kind: string; pal: BiomePalette; h: number }) {
  const leaf = pal.leaf[Math.floor(h * 3) % 3]!;
  const alt = pal.leaf[(Math.floor(h * 3) + 1) % 3]!;

  if (kind === 'pine') {
    return (
      <g>
        <rect x={-2.2} y={-13} width="4.4" height="13" rx="2" fill={pal.trunk} />
        <polygon points="0,-40 9,-22 -9,-22" fill={leaf} />
        <polygon points="0,-32 11,-13 -11,-13" fill={alt} />
        <polygon points="0,-24 12.5,-4 -12.5,-4" fill={leaf} />
      </g>
    );
  }
  if (kind === 'cypress') {
    return (
      <g>
        <rect x={-2} y={-10} width="4" height="10" rx="2" fill={pal.trunk} />
        <ellipse cx="0" cy="-24" rx="8.5" ry="19" fill={leaf} />
        <ellipse cx="-2.5" cy="-27" rx="5" ry="13" fill={lighten(leaf, 0.12)} opacity="0.8" />
      </g>
    );
  }
  if (kind === 'topiary') {
    return (
      <g>
        <path d="M -7,0 L -5.5,-7 L 5.5,-7 L 7,0 Z" fill={pal.wood} />
        <rect x={-1.8} y={-14} width="3.6" height="8" fill={pal.trunk} />
        <circle cx="0" cy="-22" r="10" fill={leaf} />
        <circle cx="-3" cy="-25" r="6" fill={lighten(leaf, 0.1)} opacity="0.75" />
      </g>
    );
  }
  return (
    <g>
      <rect x={-2.4} y={-14} width="4.8" height="14" rx="2.4" fill={pal.trunk} />
      <circle cx="0" cy="-25" r="12" fill={leaf} />
      <circle cx="-7" cy="-19" r="8.5" fill={alt} />
      <circle cx="7.5" cy="-21" r="9" fill={pal.leaf[(Math.floor(h * 3) + 2) % 3]!} />
      <circle cx="1" cy="-31" r="7.5" fill={lighten(leaf, 0.1)} />
    </g>
  );
}

function PropArt({ kind, pal }: { kind: string; pal: BiomePalette }) {
  switch (kind) {
    case 'antenna':
      return (
        <g>
          <polygon points="-5,0 5,0 2,-22 -2,-22" fill={pal.metal} />
          <line x1="0" y1="-22" x2="0" y2="-30" stroke={pal.metal} strokeWidth="1.6" />
          <circle cx="0" cy="-31.5" r="2.4" fill="#ff6b5a">
            <animate attributeName="opacity" values="1;.2;1" dur="2.4s" repeatCount="indefinite" />
          </circle>
        </g>
      );
    case 'lantern':
      return (
        <g>
          <rect x={-1.4} y={-20} width="2.8" height="20" fill={pal.wood} />
          <path d="M -5,-20 L 5,-20 L 3.5,-29 L -3.5,-29 Z" fill={pal.metal} />
          <rect x={-3.2} y={-28} width="6.4" height="8" rx="1" fill={pal.glow}>
            <animate attributeName="opacity" values=".75;1;.75" dur="3.6s" repeatCount="indefinite" />
          </rect>
        </g>
      );
    case 'books':
      return (
        <g>
          <rect x={-9} y={-5} width="18" height="5" rx="1" fill={pal.roof} />
          <rect x={-7} y={-10} width="15" height="5" rx="1" fill={pal.roof2} />
          <rect x={-5} y={-15} width="12" height="5" rx="1" fill={pal.wood} />
        </g>
      );
    case 'obelisk':
      return (
        <g>
          <polygon points="-6,0 6,0 4,-26 -4,-26" fill={pal.wallShade} />
          <polygon points="-4,-26 4,-26 0,-33" fill={pal.roof} />
        </g>
      );
    case 'easel':
      return (
        <g>
          <line x1={-7} y1="0" x2={-2} y2={-16} stroke={pal.wood} strokeWidth="2" />
          <line x1="7" y1="0" x2="2" y2={-16} stroke={pal.wood} strokeWidth="2" />
          <rect x={-9} y={-30} width="18" height="15" rx="1.5" fill={pal.wall} stroke={pal.wood} strokeWidth="1.5" />
          <path d="M -6,-19 L -1,-26 L 3,-21 L 6,-25" stroke={pal.flower[0]!} strokeWidth="1.8" fill="none" />
        </g>
      );
    case 'awning':
      return (
        <g>
          <rect x={-11} y={-12} width="22" height="12" fill={pal.wall} />
          <path d="M -13,-12 L 13,-12 L 11,-19 L -11,-19 Z" fill={pal.roof} />
        </g>
      );
    case 'paint':
      return (
        <g>
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(${-7 + i * 7},0)`}>
              <rect x={-3} y={-7} width="6" height="7" rx="1" fill={pal.metal} />
              <ellipse cx="0" cy={-7} rx="3" ry="1.4" fill={pal.flower[i % pal.flower.length]!} />
            </g>
          ))}
        </g>
      );
    case 'flowerbed':
      return (
        <g>
          <ellipse cx="0" cy="-2" rx="12" ry="6" fill={pal.sideDark} opacity="0.5" />
          {[0, 1, 2, 3].map((i) => (
            <circle
              key={i}
              cx={-7 + i * 4.6}
              cy={-5 - (i % 2) * 3}
              r="2.6"
              fill={pal.flower[i % pal.flower.length]!}
            />
          ))}
        </g>
      );
    case 'hedge':
      return (
        <g>
          <rect x={-13} y={-11} width="26" height="11" rx="4" fill={pal.leaf[0]!} />
          <rect x={-13} y={-11} width="26" height="4" rx="2" fill={lighten(pal.leaf[1]!, 0.1)} opacity="0.7" />
        </g>
      );
    case 'flagpole':
      return (
        <g>
          <ellipse cx="0" cy="0" rx="5" ry="2.4" fill={pal.wallShade} />
          <line x1="0" y1="0" x2="0" y2={-32} stroke={pal.metal} strokeWidth="1.8" />
          <path d="M 0,-32 L 14,-28 L 0,-24 Z" fill={pal.roof}>
            <animateTransform
              attributeName="transform"
              type="scale"
              values="1 1;.82 1;1 1"
              dur="2.8s"
              repeatCount="indefinite"
              additive="sum"
            />
          </path>
        </g>
      );
    case 'fountain':
      return (
        <g>
          <ellipse cx="0" cy="0" rx="13" ry="7" fill={pal.wallShade} />
          <ellipse cx="0" cy={-1.5} rx="10" ry="5" fill={pal.water} />
          <rect x={-1.5} y={-13} width="3" height="12" fill={pal.wallShade} />
          <ellipse cx="0" cy={-14} rx="5" ry="2.4" fill={pal.wall} />
        </g>
      );
    case 'crate':
      return (
        <g>
          <rect x={-7} y={-10} width="14" height="10" rx="1.2" fill="#d6a469" stroke="#a87a46" strokeWidth="1" />
          <line x1={-7} y1={-5} x2="7" y2={-5} stroke="#a87a46" strokeWidth="1" />
        </g>
      );
    case 'toolrack':
      return (
        <g>
          <rect x={-9} y={-16} width="18" height="16" rx="1.5" fill={pal.wood} />
          <line x1={-5} y1={-13} x2={-5} y2={-3} stroke={pal.metal} strokeWidth="1.6" />
          <line x1="0" y1={-13} x2="0" y2={-5} stroke={pal.metal} strokeWidth="1.6" />
          <line x1="5" y1={-13} x2="5" y2={-4} stroke={pal.metal} strokeWidth="1.6" />
        </g>
      );
    default:
      return (
        <g>
          <path d="M -8,0 L -6.5,-8 L 6.5,-8 L 8,0 Z" fill={pal.wood} />
          <ellipse cx="0" cy={-8} rx="6.5" ry="2.4" fill={pal.sideDark} />
          <circle cx={-3} cy={-11} r="3" fill={pal.leaf[1]!} />
          <circle cx="3" cy={-12} r="3.4" fill={pal.leaf[0]!} />
          <circle cx="0" cy={-14} r="2.4" fill={pal.flower[0]!} />
        </g>
      );
  }
}

/** Trees, bushes and street furniture, scattered deterministically from the seed. */
export const Decor = memo(function Decor({
  seed,
  pal,
  tree,
  props,
  tw,
  th,
  sc,
  mini,
}: SceneScale & { seed: number; pal: BiomePalette; tree: string; props: string[] }) {
  const cells = generateTerrain(seed);
  const plots = Object.values(PLOTS).map((p) => p.cell);

  const nearPlot = (c: number, r: number) =>
    plots.some((p) => Math.abs(p.c - c) <= 1 && Math.abs(p.r - r) <= 1);
  const nearRoad = (c: number, r: number) =>
    ([[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([i, j]) =>
      ROADS.has(cellKey(c + i, r + j)),
    );

  const items: { c: number; r: number; type: string; h: number; prop?: string }[] = [];
  for (const t of cells.values()) {
    if (ROADS.has(cellKey(t.c, t.r)) || nearPlot(t.c, t.r)) continue;
    const h = hashCell(t.c, t.r, seed + 3);

    if (t.kind === 'shore') {
      if (h > 0.88) items.push({ c: t.c, r: t.r, type: 'rock', h });
      continue;
    }
    if (nearRoad(t.c, t.r)) {
      if (h > 0.62) {
        items.push({ c: t.c, r: t.r, type: 'prop', h, prop: props[Math.floor(h * 97) % props.length]! });
      } else if (h > 0.5) {
        items.push({ c: t.c, r: t.r, type: 'flower', h });
      }
      continue;
    }
    if (h > 0.7) items.push({ c: t.c, r: t.r, type: 'tree', h });
    else if (h > 0.6) items.push({ c: t.c, r: t.r, type: 'bush', h });
    else if (h > 0.54) items.push({ c: t.c, r: t.r, type: 'flower', h });
    else if (h > 0.5) items.push({ c: t.c, r: t.r, type: 'rock', h });
  }
  items.sort((a, b) => a.c + a.r - (b.c + b.r));

  return (
    <g>
      {items.map((it) => {
        const p = iso(it.c, it.r, tw, th);
        const y = p.y - (cells.get(cellKey(it.c, it.r))?.h ?? 0) * ELEV * sc;
        const jx = (hashCell(it.c, it.r, seed + 11) - 0.5) * tw * 0.3;
        const jy = (hashCell(it.c, it.r, seed + 13) - 0.5) * th * 0.3;

        return (
          <g key={`d${it.c}_${it.r}`} transform={`translate(${p.x + jx},${y + jy}) scale(${sc})`}>
            <Shadow
              rx={it.type === 'tree' ? 13 : 9}
              ry={it.type === 'tree' ? 5 : 3.5}
              o={0.17}
              cy={1.5}
            />
            {it.type === 'tree' && <TreeArt kind={tree} pal={pal} h={it.h} />}
            {it.type === 'bush' && (
              <g>
                <circle cx={-4} cy={-6} r="7" fill={pal.leaf[0]!} />
                <circle cx="4.5" cy={-7} r="8" fill={pal.leaf[1]!} />
                <circle cx="0" cy={-11} r="5.5" fill={pal.leaf[2]!} />
              </g>
            )}
            {it.type === 'flower' && (
              <g>
                {[0, 1, 2].map((i) => (
                  <g key={i} transform={`translate(${-5 + i * 5},${-(i % 2) * 2})`}>
                    <line x1="0" y1="0" x2="0" y2={-7} stroke={pal.leaf[0]!} strokeWidth="1.3" />
                    <circle
                      cx="0"
                      cy={-8}
                      r="2.6"
                      fill={pal.flower[(i + Math.floor(it.h * 5)) % pal.flower.length]!}
                    />
                  </g>
                ))}
              </g>
            )}
            {it.type === 'rock' && (
              <g>
                <polygon points="-10,2 -4,-8 5,-9 11,1 3,5 -5,5" fill={pal.rock} />
                <polygon points="-4,-8 5,-9 11,1 3,-2" fill={pal.rockMid} opacity="0.7" />
              </g>
            )}
            {it.type === 'prop' && !mini && <PropArt kind={it.prop!} pal={pal} />}
          </g>
        );
      })}
    </g>
  );
});

export const FULL_TILE_W = TILE_W;
