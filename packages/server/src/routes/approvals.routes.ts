import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';

const listQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});

export function createApprovalsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }
    res.json(ctx.world.listApprovalViews(parsed.data.status));
  });

  return router;
}
