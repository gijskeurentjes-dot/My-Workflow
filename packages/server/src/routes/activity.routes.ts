import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';

const listQuery = z.object({
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  botId: z.string().optional(),
  islandId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export function createActivityRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }
    res.json(ctx.world.listActivity(parsed.data));
  });

  return router;
}
