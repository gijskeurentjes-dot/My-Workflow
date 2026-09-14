import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { API_BASE } from '@ai-islands/shared';
import { config } from './config.js';
import type { AppContext } from './context.js';
import { createApiRouter } from './routes/index.js';

export function createApp(ctx: AppContext): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    cors({
      origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '256kb' }));

  app.use(API_BASE, createApiRouter(ctx));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Four arguments, or Express does not recognise this as an error handler.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    // eslint-disable-next-line no-console
    console.error('[api]', err);
    res.status(500).json({ error: message });
  });

  return app;
}
