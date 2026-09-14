import { Router } from 'express';
import type { AppContext } from '../context.js';

export function createIslandsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(ctx.repos.islands.list());
  });

  router.get('/:id', (req, res) => {
    const island = ctx.repos.islands.findById(req.params.id);
    if (!island) {
      res.status(404).json({ error: 'Island not found' });
      return;
    }

    res.json({
      island,
      bots: ctx.repos.bots.findByIsland(island.id).map((b) => ctx.world.findBotView(b.id)),
      tasks: ctx.world.listTaskViews({ islandId: island.id }),
      activity: ctx.world.listActivity({ islandId: island.id, limit: 40 }),
    });
  });

  return router;
}
