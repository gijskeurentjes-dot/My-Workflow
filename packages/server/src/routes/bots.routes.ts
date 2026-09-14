import { Router } from 'express';
import type { AppContext } from '../context.js';

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

  return router;
}
