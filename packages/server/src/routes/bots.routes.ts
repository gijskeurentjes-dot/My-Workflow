import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { command, parseBody } from './helpers.js';

const updateBody = z
  .object({
    name: z.string().min(1).max(80).optional(),
    role: z.string().max(120).optional(),
    /** What a real engine would send as this agent's system prompt. */
    instructions: z.string().max(8000).optional(),
    tools: z.array(z.string().min(1).max(80)).max(32).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export function createBotsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(ctx.world.listBotViews());
  });

  router.get('/:id', (req, res) => {
    const bot = ctx.world.findBotView(req.params.id);
    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    res.json({
      bot,
      // The bot's own history, which is what the detail panel shows.
      activity: ctx.world.listActivity({ botId: bot.id, limit: 30 }),
      tasks: ctx.world.listTaskViews({ botId: bot.id }),
    });
  });

  router.patch('/:id', (req, res) => {
    const body = parseBody(updateBody, req.body, res);
    if (!body) return;
    command(ctx, res, () => {
      const { bot, changes } = ctx.workflow.updateBot(req.params.id, body);
      return { changes, body: bot };
    });
  });

  return router;
}
