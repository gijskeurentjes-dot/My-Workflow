import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** packages/server, whether running from src (tsx) or dist (node). */
export const PACKAGE_ROOT = path.resolve(here, '..');

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) {
    throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  }
  return n;
}

/**
 * Resolve DATABASE_URL into a filesystem path.
 *
 * Accepts `file:./data/x.sqlite`, a bare path, or `:memory:`. Relative paths
 * resolve from the server package so the database lands in the same place
 * whether you start the app from the repo root or from here.
 */
function resolveDatabasePath(raw: string): string {
  const trimmed = raw.replace(/^file:/, '');
  if (trimmed === ':memory:') return ':memory:';
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(PACKAGE_ROOT, trimmed);
}

const databaseUrl = str('DATABASE_URL', 'file:./data/ai-islands.sqlite');

export const config = {
  env: str('NODE_ENV', 'development'),
  port: int('PORT', 4000),

  databaseUrl,
  databasePath: resolveDatabasePath(databaseUrl),

  /**
   * Which engine drives the world. Only 'mock' is implemented; 'claude' is
   * reserved so the switch exists before the implementation does.
   */
  agentEngine: str('AGENT_ENGINE', 'mock'),
  agentTickMs: int('AGENT_TICK_MS', 500),

  corsOrigin: str('CORS_ORIGIN', 'http://localhost:5173'),

  /** How many activity rows a snapshot carries. */
  activityLimit: int('ACTIVITY_LIMIT', 120),

  /** SSE keep-alive interval. Below the 30s most proxies time out at. */
  heartbeatMs: int('HEARTBEAT_MS', 20_000),
} as const;

export const isProduction = config.env === 'production';
