import { mix } from './color.js';
import type { BiomeKey } from './types.js';

/**
 * A biome is a place, not a hue: it carries its own flora, architecture and
 * street furniture as well as a palette.
 */
export interface BiomePalette {
  grass: string[];
  side: string;
  sideDark: string;
  shore: string;
  shoreSide: string;
  foam: string;
  water: string;
  waterDeep: string;
  rock: string;
  rockMid: string;
  rockDeep: string;
  roof: string;
  roof2: string;
  wall: string;
  wallShade: string;
  wood: string;
  metal: string;
  leaf: string[];
  trunk: string;
  flower: string[];
  glow: string;
}

export interface Biome {
  label: string;
  accent: string;
  /** Building silhouette used on this island. */
  arch: 'civic' | 'classical' | 'industrial' | 'cottage' | 'glass';
  tree: 'pine' | 'cypress' | 'round' | 'topiary';
  props: string[];
  light: BiomePalette;
  dark: BiomePalette;
}

const DEFS: Record<BiomeKey, Omit<Biome, 'light' | 'dark'> & { pal: BiomePalette }> = {
  civic: {
    label: 'Civic',
    accent: '#3f86d6',
    arch: 'civic',
    tree: 'topiary',
    props: ['flagpole', 'fountain', 'hedge', 'planter'],
    pal: {
      grass: ['#7fcb9d', '#70c090', '#64b585', '#90d7ab'],
      side: '#519a72',
      sideDark: '#40805d',
      shore: '#ebe8d4',
      shoreSide: '#c6c2a6',
      foam: '#f2fbff',
      water: '#4fabe8',
      waterDeep: '#2d83c2',
      rock: '#949aad',
      rockMid: '#767d92',
      rockDeep: '#525a70',
      roof: '#3572b8',
      roof2: '#26558f',
      wall: '#f4f8fc',
      wallShade: '#d8e0ea',
      wood: '#63503a',
      metal: '#c7d2dd',
      leaf: ['#3f9a7c', '#4cab8b', '#34866c'],
      trunk: '#5b4a35',
      flower: ['#a8d8ff', '#ffd8a8'],
      glow: '#ffe9c0',
    },
  },
  scholar: {
    label: 'Scholarly',
    accent: '#7a63d8',
    arch: 'classical',
    tree: 'cypress',
    props: ['lantern', 'books', 'obelisk', 'planter'],
    pal: {
      grass: ['#8ac785', '#7dbb79', '#71b06f', '#95d18f'],
      side: '#5d9459',
      sideDark: '#497a46',
      shore: '#efe2f2',
      shoreSide: '#cbb4d0',
      foam: '#fbf2ff',
      water: '#8a94e8',
      waterDeep: '#5a66c6',
      rock: '#9e86a6',
      rockMid: '#7d6785',
      rockDeep: '#544460',
      roof: '#6f55c6',
      roof2: '#54409c',
      wall: '#f8f3fc',
      wallShade: '#ded4ea',
      wood: '#6b4b32',
      metal: '#c3bcd6',
      leaf: ['#49916b', '#54a179', '#3c7d5c'],
      trunk: '#5f452e',
      flower: ['#c9a7f0', '#f2c2e0'],
      glow: '#ffe2b8',
    },
  },
  forge: {
    label: 'Industrial',
    accent: '#e07a3c',
    arch: 'industrial',
    tree: 'pine',
    props: ['antenna', 'crate', 'toolrack', 'planter'],
    pal: {
      grass: ['#a3ce69', '#95c35c', '#89b953', '#aed877'],
      side: '#7ba442',
      sideDark: '#658a35',
      shore: '#f1e4bb',
      shoreSide: '#cfb787',
      foam: '#eafbff',
      water: '#5ec8e0',
      waterDeep: '#3aa3c2',
      rock: '#a98b6e',
      rockMid: '#8a6e55',
      rockDeep: '#5f4a39',
      roof: '#d9702f',
      roof2: '#a9521d',
      wall: '#fbf8ee',
      wallShade: '#e3dcc9',
      wood: '#7d5a3a',
      metal: '#b9c4cc',
      leaf: ['#4c9c49', '#57a851', '#428a3f'],
      trunk: '#6b4a31',
      flower: ['#ffd166', '#f4978e'],
      glow: '#ffe6ae',
    },
  },
  studio: {
    label: 'Creative',
    accent: '#2bb3a3',
    arch: 'cottage',
    tree: 'round',
    props: ['easel', 'awning', 'paint', 'flowerbed'],
    pal: {
      grass: ['#9ed0a0', '#90c793', '#84bd88', '#aedcae'],
      side: '#5fa06a',
      sideDark: '#4c8556',
      shore: '#f8e2aa',
      shoreSide: '#d8bb7c',
      foam: '#fff6e2',
      water: '#5ecac2',
      waterDeep: '#38a49d',
      rock: '#b78c66',
      rockMid: '#96714f',
      rockDeep: '#69503a',
      roof: '#26a294',
      roof2: '#187a6f',
      wall: '#fef5e6',
      wallShade: '#ead9be',
      wood: '#87613b',
      metal: '#cbb9a4',
      leaf: ['#5aa84c', '#6cbb5b', '#4b9240'],
      trunk: '#7a5231',
      flower: ['#ff9ec4', '#ffd166', '#f7845c'],
      glow: '#ffdfa3',
    },
  },
  ledger: {
    label: 'Analytical',
    accent: '#3aa85f',
    arch: 'glass',
    tree: 'topiary',
    props: ['hedge', 'planter', 'obelisk', 'fountain'],
    pal: {
      grass: ['#8fc489', '#83b97e', '#78ae74', '#9bd094'],
      side: '#5f9159',
      sideDark: '#4a7747',
      shore: '#eee6d2',
      shoreSide: '#c9bfa4',
      foam: '#f6fbff',
      water: '#4b93b8',
      waterDeep: '#2c6a8f',
      rock: '#9b9382',
      rockMid: '#7c7566',
      rockDeep: '#545044',
      roof: '#2f9e5f',
      roof2: '#1c6c40',
      wall: '#f8f4e9',
      wallShade: '#e0d9c6',
      wood: '#6f5738',
      metal: '#c9ab6d',
      leaf: ['#468a5f', '#529a6c', '#3a7550'],
      trunk: '#5e4a30',
      flower: ['#e8c66a', '#f2efe2'],
      glow: '#ffe3ae',
    },
  },
};

/** Night palettes are derived, so every biome stays consistent across themes. */
const NIGHT = '#141d36';

function nightify(p: BiomePalette): BiomePalette {
  const m = (c: string, t: number) => mix(c, NIGHT, t);
  return {
    grass: p.grass.map((c) => m(c, 0.5)),
    side: m(p.side, 0.54),
    sideDark: m(p.sideDark, 0.6),
    shore: m(p.shore, 0.52),
    shoreSide: m(p.shoreSide, 0.58),
    foam: m(p.foam, 0.5),
    water: m(p.water, 0.45),
    waterDeep: m(p.waterDeep, 0.55),
    rock: m(p.rock, 0.58),
    rockMid: m(p.rockMid, 0.64),
    rockDeep: m(p.rockDeep, 0.7),
    roof: m(p.roof, 0.36),
    roof2: m(p.roof2, 0.44),
    wall: m(p.wall, 0.48),
    wallShade: m(p.wallShade, 0.56),
    wood: m(p.wood, 0.5),
    metal: m(p.metal, 0.52),
    leaf: p.leaf.map((c) => m(c, 0.54)),
    trunk: m(p.trunk, 0.55),
    flower: p.flower.map((c) => m(c, 0.4)),
    glow: p.glow,
  };
}

export const BIOMES: Record<BiomeKey, Biome> = Object.fromEntries(
  (Object.keys(DEFS) as BiomeKey[]).map((k) => {
    const d = DEFS[k];
    return [k, { label: d.label, accent: d.accent, arch: d.arch, tree: d.tree, props: d.props, light: d.pal, dark: nightify(d.pal) }];
  }),
) as Record<BiomeKey, Biome>;

export const BIOME_KEYS = Object.keys(BIOMES) as BiomeKey[];

/**
 * Appearance for a newly created project.
 *
 * Biomes cycle so consecutive projects look different, and the seed is derived
 * from the project count rather than random, so the same nth project always
 * draws the same island.
 */
export function appearanceForIndex(index: number): {
  biome: BiomeKey;
  seed: number;
  layout: { col: number; row: number };
} {
  const biomes = BIOME_KEYS;
  return {
    biome: biomes[index % biomes.length]!,
    // Spread across the seed space so neighbouring projects do not share a
    // coastline; the multiplier is arbitrary but fixed.
    seed: 1.2 + ((index * 2.7) % 9),
    layout: { col: index % 3, row: Math.floor(index / 3) },
  };
}

/** Suggested names for the first few projects, used only by the demo seed. */
export const DEMO_PROJECTS: {
  name: string;
  description: string;
  /** What done looks like, written as a person would write it. */
  goals: string;
  repository: string;
  color: string;
}[] = [
  {
    name: 'Q4 Product Launch',
    description: 'Ship the new pricing page and the launch deck before the quarter closes.',
    goals: [
      'The new pricing page is live and converting at least as well as the old one.',
      'The launch deck is approved by the exec team.',
      'Support has the answers to the five questions we expect most.',
    ].join('\n'),
    repository: 'github.com/example/pricing-site',
    color: '#f4834f',
  },
  {
    name: 'Market Research Refresh',
    description: 'Understand where we sit against the three closest competitors.',
    goals: [
      'A current picture of the three competitors we actually lose deals to.',
      'Every claim in it carries the source it came from.',
      'The open questions are listed as open, not filled in.',
    ].join('\n'),
    repository: '',
    color: '#7a63d8',
  },
  {
    name: 'FY26 Budget',
    description: 'Build a defensible baseline and a lean scenario.',
    goals: [
      'A baseline anyone can trace back to its assumptions.',
      'A lean scenario that survives a 20% revenue miss.',
      'The model balances, and the checks say so.',
    ].join('\n'),
    repository: '',
    color: '#3aa85f',
  },
];
