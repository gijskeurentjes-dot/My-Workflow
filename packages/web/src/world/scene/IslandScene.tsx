import { useMemo } from 'react';
import {
  APPROVAL_PLOT,
  BIOMES,
  CY,
  ELEV,
  PLOTS,
  PLOT_KEYS,
  TILE_H,
  TILE_W,
  findPath,
  generateTerrain,
  iso,
  type PlotKey,
  type Project,
  type Task,
} from '@ai-islands/shared';
import type { AgentDisplay } from '../selectors.js';
import { AgentSprite } from './AgentSprite.js';
import { Building } from './Buildings.js';
import { Decor, Roads, Terrain } from './Terrain.js';

export interface IslandSceneProps {
  /** A project is an island; its appearance draws the terrain. */
  project: Project;
  agents: AgentDisplay[];
  /** This project's tasks, used to show waiting work on the island. */
  tasks?: Task[];
  /** Shared animation clock, in ms. */
  clock: number;
  theme: 'light' | 'dark';
  /** Mini renders the small card version: no labels, no props, less detail. */
  mini?: boolean;
  selectedAgentId?: string | null;
  selectedPlot?: PlotKey | null;
  onSelectAgent?: (agentId: string) => void;
  onSelectPlot?: (plot: PlotKey) => void;
  onClearSelection?: () => void;
}

/**
 * One island, drawn as a single SVG.
 *
 * Everything on it is a real element rather than pixels on a canvas, so agents
 * are focusable, labelled and announced. The world is the pleasant way to read
 * the state; the panels beside it are the complete way.
 */
export function IslandScene({
  project,
  agents,
  tasks = [],
  clock,
  theme,
  mini = false,
  selectedAgentId = null,
  selectedPlot = null,
  onSelectAgent,
  onSelectPlot,
  onClearSelection,
}: IslandSceneProps) {
  const tw = mini ? 34 : TILE_W;
  const th = mini ? 17 : TILE_H;
  const sc = tw / TILE_W;
  const biome = BIOMES[project.appearance.biome];
  const pal = biome[theme];
  const seed = project.appearance.seed;

  // Which plots have someone working at them, so their lights come on.
  const activePlots = new Set<PlotKey>();
  const attentionPlots = new Set<PlotKey>();
  for (const d of agents) {
    if (d.movement === 'working') activePlots.add(d.agent.currentLocation);
    if (d.agent.status === 'waiting_approval' && !d.agent.movement) {
      attentionPlots.add(APPROVAL_PLOT);
    }
  }

  // Waiting work is pinned at the meeting circle, so a full board is visible.
  const backlog = tasks.filter((t) => t.status === 'backlog').length;

  // Painter's order: anything nearer the viewer is drawn last.
  const scenery = [
    ...PLOT_KEYS.map((key) => ({
      kind: 'plot' as const,
      key,
      c: PLOTS[key].cell.c,
      r: PLOTS[key].cell.r,
    })),
    ...agents.map((d) => ({
      kind: 'agent' as const,
      display: d,
      c: d.position.c,
      r: d.position.r,
    })),
  ].sort((a, b) => a.c + a.r - (b.c + b.r));

  // The viewBox has to contain the terrain, the lagoon and the rock underside.
  const box = useMemo(() => {
    const cells = generateTerrain(seed);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;

    for (const t of cells.values()) {
      const p = iso(t.c, t.r, tw, th);
      x0 = Math.min(x0, p.x - tw / 2);
      x1 = Math.max(x1, p.x + tw / 2);
      y0 = Math.min(y0, p.y - th / 2 - t.h * ELEV * sc);
      y1 = Math.max(y1, p.y + th / 2);
    }

    const padX = (mini ? 6 : 18) + 1.25 * tw;
    const top = (mini ? 16 : 52) + 1.1 * th;
    const bottom = (mini ? 8 : 20) + 1.1 * th + (mini ? 132 : 235) * sc;
    return { x0: x0 - padX, x1: x1 + padX, y0: y0 - top, y1: y1 + bottom, floor: y1 };
  }, [seed, tw, th, sc, mini]);

  const haloId = `halo-${project.id}`;

  return (
    <svg
      viewBox={`${box.x0} ${box.y0} ${box.x1 - box.x0} ${box.y1 - box.y0}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      onClick={onClearSelection}
      role="img"
      aria-label={`${project.name}: ${agents.length === 0 ? 'nobody on this island' : agents.map((d) => `${d.agent.name} ${d.doing}`).join('. ')}`}
    >
      <defs>
        <radialGradient id={haloId} cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor={biome.accent} stopOpacity={mini ? '0.10' : '0.16'} />
          <stop offset="100%" stopColor={biome.accent} stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect
        x={box.x0}
        y={box.y0}
        width={box.x1 - box.x0}
        height={box.y1 - box.y0}
        fill={`url(#${haloId})`}
      />
      <ellipse
        cx="0"
        cy={box.floor + (mini ? 20 : 58)}
        rx={(box.x1 - box.x0) * 0.32}
        ry={mini ? 10 : 22}
        fill="var(--cloud)"
        opacity={mini ? '0.3' : '0.38'}
      />

      <Terrain seed={seed} pal={pal} tw={tw} th={th} sc={sc} mini={mini} />
      <Roads seed={seed} pal={pal} tw={tw} th={th} sc={sc} mini={mini} />
      <Decor
        seed={seed}
        pal={pal}
        tree={biome.tree}
        props={biome.props}
        tw={tw}
        th={th}
        sc={sc}
        mini={mini}
      />

      {/* Route lines make the link between a task and the walk it causes visible. */}
      {!mini &&
        agents
          .filter((d) => d.agent.movement)
          .map((d) => {
            const move = d.agent.movement!;
            const col = d.profile.color.base;
            const pts = [
              iso(d.position.c, d.position.r, tw, th),
              ...findPath(move.fromKey, move.toKey).map((c) => iso(c.c, c.r, tw, th)),
            ];
            const path = pts
              .map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`)
              .join(' ');
            const end = pts[pts.length - 1]!;

            return (
              <g key={`route-${d.agent.id}`} style={{ pointerEvents: 'none' }}>
                <path
                  d={path}
                  fill="none"
                  stroke={col}
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  strokeDasharray="2 10"
                  opacity="0.6"
                >
                  <animate attributeName="stroke-dashoffset" values="24;0" dur="1.1s" repeatCount="indefinite" />
                </path>
                <g transform={`translate(${end.x},${end.y})`}>
                  <circle r="4" fill="none" stroke={col} strokeWidth="2.2">
                    <animate attributeName="r" values="4;13;4" dur="2s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values=".9;0;.9" dur="2s" repeatCount="indefinite" />
                  </circle>
                  <circle r="3.2" fill={col} opacity="0.9" />
                </g>
              </g>
            );
          })}

      {scenery.map((item) =>
        item.kind === 'plot' ? (
          <Building
            key={`plot-${item.key}`}
            plotKey={item.key}
            pal={pal}
            arch={biome.arch}
            tw={tw}
            th={th}
            sc={sc}
            mini={mini}
            crates={project.crates}
            active={activePlots.has(item.key)}
            needsAttention={attentionPlots.has(item.key)}
            backlog={backlog}
            selected={selectedPlot === item.key}
            {...(onSelectPlot ? { onSelect: onSelectPlot } : {})}
          />
        ) : (
          <AgentSprite
            key={item.display.agent.id}
            display={item.display}
            clock={clock}
            tw={tw}
            th={th}
            sc={sc}
            mini={mini}
            selected={selectedAgentId === item.display.agent.id}
            {...(onSelectAgent ? { onSelect: onSelectAgent } : {})}
          />
        ),
      )}

      {/* Birds, purely for life. Hidden on the mini cards. */}
      {!mini &&
        [0, 1, 2].map((i) => (
          <g key={`bird${i}`} opacity="0.45" style={{ pointerEvents: 'none' }}>
            <animateTransform
              attributeName="transform"
              type="translate"
              values={`${box.x0 - 60},${box.y0 + 30 + i * 22}; ${box.x1 + 60},${box.y0 + 10 + i * 26}`}
              dur={`${38 + i * 9}s`}
              repeatCount="indefinite"
            />
            <path
              d="M -7,0 q 3.5,-4 7,0 q 3.5,-4 7,0"
              stroke="var(--ink-3)"
              strokeWidth="1.6"
              fill="none"
              strokeLinecap="round"
            />
          </g>
        ))}
    </svg>
  );
}

export const SCENE_CENTRE = CY;
