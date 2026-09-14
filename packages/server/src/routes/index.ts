import { Router } from 'express';
import type { AppContext } from '../context.js';
import { createActivityRouter } from './activity.routes.js';
import { createApprovalsRouter } from './approvals.routes.js';
import { createBotsRouter } from './bots.routes.js';
import { createIslandsRouter } from './islands.routes.js';
import { createProjectsRouter } from './projects.routes.js';
import { createStreamRouter } from './stream.routes.js';
import { createTasksRouter } from './tasks.routes.js';
import { createWorldRouter } from './world.routes.js';

/** Mounts every route under /api. */
export function createApiRouter(ctx: AppContext): Router {
  const router = Router();

  router.use('/', createWorldRouter(ctx));
  router.use('/', createStreamRouter(ctx));
  router.use('/islands', createIslandsRouter(ctx));
  router.use('/bots', createBotsRouter(ctx));
  router.use('/projects', createProjectsRouter(ctx));
  router.use('/tasks', createTasksRouter(ctx));
  router.use('/approvals', createApprovalsRouter(ctx));
  router.use('/activity', createActivityRouter(ctx));

  return router;
}
