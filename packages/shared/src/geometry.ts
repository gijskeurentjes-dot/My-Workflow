import type { PlotInfo, PlotKey } from './types.js';

/**
 * Isometric world geometry, shared by both sides of the app.
 *
 * The server needs it to work out how long a walk between two plots takes.
 * The client needs it to draw that walk. Keeping one copy means a bot can
 * never be animated along a route the server did not actually plan.
 */

/** Tile width and height — a 2:1 isometric diamond. */
export const TILE_W = 76;
export const TILE_H = 38;

/** The island grid is GRID × GRID tiles, centred on (CX, CY). */
export const GRID = 17;
export const CX = 8;
export const CY = 8;

/** Vertical lift per terrain elevation level, in pixels. */
export const ELEV = 11;

/** Radius of the grass, and of the beach beyond it, in tiles. */
export const GRASS_R = 6.3;
export const SHORE_R = 6.95;

/** How fast a bot walks, in tiles per second. */
export const WALK_TILES_PER_SECOND = 2;

export interface Point {
  x: number;
  y: number;
}

export interface Cell {
  c: number;
  r: number;
}

/** Project a grid cell to screen space. */
export function iso(c: number, r: number, tw: number = TILE_W, th: number = TILE_H): Point {
  return { x: ((c - r) * tw) / 2, y: ((c + r) * th) / 2 };
}

/** Cell key used for map lookups. */
export const cellKey = (c: number, r: number): string => `${c}:${r}`;

// ─────────────────────────────────────────────────────────────────────────────
// Plots — the five places on every island
// ─────────────────────────────────────────────────────────────────────────────

export const PLOTS: Record<PlotKey, PlotInfo> = {
  hq: {
    key: 'hq',
    label: 'Headquarters',
    icon: '\u{1F3E2}',
    purpose:
      'Coordination, planning and review. Finished work is brought here for your approval.',
    cell: { c: 8, r: 5 },
  },
  library: {
    key: 'library',
    label: 'Research Library',
    icon: '\u{1F4DA}',
    purpose: 'Sources, reading and written research reports.',
    cell: { c: 4, r: 7 },
  },
  workshop: {
    key: 'workshop',
    label: 'Workshop',
    icon: '\u{1F6E0}\uFE0F',
    purpose: 'Code, builds, tests and technical deliverables.',
    cell: { c: 12, r: 7 },
  },
  rest: {
    key: 'rest',
    label: 'Meeting Circle',
    icon: '\u{1F525}',
    purpose: 'Where agents wait and hand off work between jobs.',
    cell: { c: 8, r: 8 },
  },
  studio: {
    key: 'studio',
    label: 'Presentation Studio',
    icon: '\u{1F4FD}\uFE0F',
    purpose: 'Slide decks, storylines, charts and speaker notes.',
    cell: { c: 4, r: 11 },
  },
  data: {
    key: 'data',
    label: 'Data Workshop',
    icon: '\u{1F9EE}',
    purpose: 'Workbooks, formulas, models and dashboards.',
    cell: { c: 12, r: 11 },
  },
  gate: {
    key: 'gate',
    label: 'Gate',
    icon: '\u26E9\uFE0F',
    purpose: 'The way on and off the island.',
    cell: { c: 6, r: 13 },
  },
  depot: {
    key: 'depot',
    label: 'Delivery Depot',
    icon: '\u{1F4E6}',
    purpose: 'Approved work, crated and logged. One crate per delivery.',
    cell: { c: 10, r: 13 },
  },
};

/** Finished work is brought to headquarters for your decision. */
export const APPROVAL_PLOT: PlotKey = 'hq';

/** Approved work is carried to the depot, and arriving there completes it. */
export const DELIVERY_PLOT: PlotKey = 'depot';

/** Where an agent waits when it has nothing to do. */
export const REST_PLOT: PlotKey = 'rest';

export const PLOT_KEYS = Object.keys(PLOTS) as PlotKey[];

/** Walkable tiles: a main street, two cross streets and the depot lane. */
export const ROADS: ReadonlySet<string> = (() => {
  const s = new Set<string>();
  for (let r = 5; r <= 13; r++) s.add(cellKey(8, r)); // main street
  for (let c = 4; c <= 12; c++) {
    s.add(cellKey(c, 7)); // upper cross street
    s.add(cellKey(c, 11)); // lower cross street
  }
  for (let c = 6; c <= 10; c++) s.add(cellKey(c, 13)); // depot lane
  for (const p of Object.values(PLOTS)) s.add(cellKey(p.cell.c, p.cell.r));
  return s;
})();

// ─────────────────────────────────────────────────────────────────────────────
// Terrain
// ─────────────────────────────────────────────────────────────────────────────

/** Deterministic per-cell hash, used to scatter decor without storing it. */
export function hashCell(c: number, r: number, seed: number): number {
  const n = Math.sin(c * 127.1 + r * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Smooth, deterministic value noise for the hills. */
function noise2(c: number, r: number, seed: number): number {
  return (
    (Math.sin(c * 0.82 + seed * 3.1) +
      Math.sin(r * 0.74 - seed * 1.7) +
      Math.sin((c + r) * 0.5 + seed * 2.2) +
      Math.sin((c - r) * 0.63 - seed * 1.1)) /
      8 +
    0.5
  );
}

/** How far the coastline bulges at a given angle. Shared by terrain and coast. */
export function coastWobble(angle: number, seed: number): number {
  return (
    0.34 * Math.sin(angle * 3 + seed * 1.3) +
    0.22 * Math.cos(angle * 2 - seed * 0.7) +
    0.14 * Math.sin(angle * 5 + seed)
  );
}

export interface TerrainCell extends Cell {
  kind: 'grass' | 'shore';
  /** Distance from the island centre, wobble already applied. */
  d: number;
  /** Elevation level: 0, 1 or 2. */
  h: number;
}

const terrainCache = new Map<number, Map<string, TerrainCell>>();

/**
 * Build an island's tiles from its seed. Cached, because the shape never
 * changes and both the mini and full renderers ask for it.
 */
export function generateTerrain(seed: number): Map<string, TerrainCell> {
  const cached = terrainCache.get(seed);
  if (cached) return cached;

  const cells = new Map<string, TerrainCell>();
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const dx = c - CX;
      const dy = r - CY;
      const d = Math.hypot(dx, dy) - coastWobble(Math.atan2(dy, dx), seed);
      const kind = d <= GRASS_R ? 'grass' : d <= SHORE_R ? 'shore' : null;
      if (kind) cells.set(cellKey(c, r), { c, r, kind, d, h: 0 });
    }
  }

  // Hills, but the streets and their verges stay flat so roads read as roads.
  const flat = new Set<string>();
  for (const k of ROADS) {
    const [c, r] = k.split(':').map(Number) as [number, number];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) flat.add(cellKey(c + i, r + j));
  }
  for (const t of cells.values()) {
    if (t.kind !== 'grass' || flat.has(cellKey(t.c, t.r))) continue;
    const edge = Math.max(0, 1 - Math.max(0, t.d - 3.2) / 3); // hills fade toward the shore
    const v = noise2(t.c, t.r, seed) * edge;
    t.h = v > 0.55 ? 2 : v > 0.38 ? 1 : 0;
  }
  // Knock down lonely spikes so the hills read as one landscape.
  for (const t of cells.values()) {
    if (t.h !== 2) continue;
    const tall = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).filter(([i, j]) => {
      const n = cells.get(cellKey(t.c + i, t.r + j));
      return n && n.h >= 1;
    }).length;
    if (tall < 2) t.h = 1;
  }

  terrainCache.set(seed, cells);
  return cells;
}

export const heightAt = (cells: Map<string, TerrainCell>, c: number, r: number): number =>
  cells.get(cellKey(c, r))?.h ?? 0;

/** Tiles painted back to front, so nearer tiles overlap farther ones. */
export function drawOrder(cells: Map<string, TerrainCell>): TerrainCell[] {
  return [...cells.values()].sort((a, b) => a.c + a.r - (b.c + b.r) || a.c - b.c);
}

/** Tiles on the island's edge — where cliffs and stalactites are drawn. */
export function rimCells(cells: Map<string, TerrainCell>): TerrainCell[] {
  return [...cells.values()].filter((t) =>
    ([[-1, 0], [1, 0], [0, -1], [0, 1]] as const).some(
      ([i, j]) => !cells.has(cellKey(t.c + i, t.r + j)),
    ),
  );
}

/**
 * The island is star-shaped around its centre, so the coastline can be traced
 * analytically — a smooth organic outline instead of a stepped grid.
 */
export function coastPoints(
  seed: number,
  radius: number,
  tw: number,
  th: number,
  n = 88,
): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = radius + coastWobble(a, seed);
    pts.push(iso(CX + Math.cos(a) * r, CY + Math.sin(a) * r, tw, th));
  }
  return pts;
}

/** Close a point list into a smooth Catmull-Rom-ish SVG path. */
export function closedSpline(pts: Point[]): string {
  const n = pts.length;
  if (n === 0) return '';
  const first = pts[0]!;
  let d = `M ${first.x.toFixed(1)},${first.y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[(i + 2) % n]!;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return `${d} Z`;
}

export const coastPath = (seed: number, radius: number, tw: number, th: number): string =>
  closedSpline(coastPoints(seed, radius, tw, th));

// ─────────────────────────────────────────────────────────────────────────────
// Pathfinding
// ─────────────────────────────────────────────────────────────────────────────

const pathCache = new Map<string, Cell[]>();

/**
 * Breadth-first search over the road network. Returns the cells to walk
 * through, excluding the one already stood on. Cached — the road network is
 * fixed, so every route is computed at most once per process.
 */
export function findPath(fromKey: PlotKey, toKey: PlotKey): Cell[] {
  if (fromKey === toKey) return [];
  const memo = `${fromKey}>${toKey}`;
  const hit = pathCache.get(memo);
  if (hit) return hit;

  const start = PLOTS[fromKey].cell;
  const goal = PLOTS[toKey].cell;
  const sk = cellKey(start.c, start.r);
  const gk = cellKey(goal.c, goal.r);

  const prev = new Map<string, string | null>([[sk, null]]);
  const queue: string[] = [sk];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === gk) break;
    const [c, r] = cur.split(':').map(Number) as [number, number];
    for (const [nc, nr] of [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]] as const) {
      const k = cellKey(nc, nr);
      if (ROADS.has(k) && !prev.has(k)) {
        prev.set(k, cur);
        queue.push(k);
      }
    }
  }

  if (!prev.has(gk)) {
    pathCache.set(memo, []);
    return [];
  }

  const out: Cell[] = [];
  let cur: string | null = gk;
  while (cur) {
    const [c, r] = cur.split(':').map(Number) as [number, number];
    out.unshift({ c, r });
    cur = prev.get(cur) ?? null;
  }
  out.shift(); // drop the tile already stood on
  pathCache.set(memo, out);
  return out;
}

/** How long the walk between two plots takes, in milliseconds. */
export function travelDurationMs(fromKey: PlotKey, toKey: PlotKey): number {
  const steps = findPath(fromKey, toKey).length;
  if (steps === 0) return 0;
  return Math.round((steps / WALK_TILES_PER_SECOND) * 1000);
}

/**
 * Where a bot is partway along a route, in grid coordinates.
 * `t` runs 0 (at `fromKey`) to 1 (arrived at `toKey`).
 */
export function positionAlongPath(fromKey: PlotKey, toKey: PlotKey, t: number): Cell {
  const from = PLOTS[fromKey].cell;
  const path = findPath(fromKey, toKey);
  if (path.length === 0) return { ...from };

  const clamped = Math.min(1, Math.max(0, t));
  const travelled = clamped * path.length;
  const leg = Math.min(path.length - 1, Math.floor(travelled));
  const legT = travelled - leg;
  const a = leg === 0 ? from : path[leg - 1]!;
  const b = path[leg]!;
  return { c: a.c + (b.c - a.c) * legT, r: a.r + (b.r - a.r) * legT };
}
