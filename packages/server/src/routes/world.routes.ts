import { Router } from 'express';
import type { AppContext } from '../context.js';

/** The whole-world endpoints: snapshot, stats, engine info and demo reset. */
export function createWorldRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true, at: Date.now(), engine: ctx.world.engineInfo() });
  });

  router.get('/world', (_req, res) => {
    res.json(ctx.world.snapshot());
  });

  router.get('/stats', (_req, res) => {
    res.json(ctx.world.stats());
  });

  router.get('/engine', (_req, res) => {
    res.json(ctx.world.engineInfo());
  });

  /**
   * Wipe the world and replay the demo seed.
   *
   * POST rather than GET: it destroys data, so it must not be reachable by a
   * link or a prefetch.
   */
  router.post('/reset', (_req, res) => {
    ctx.resetDemoData();
    res.json(ctx.world.snapshot());
  });

  return router;
}
