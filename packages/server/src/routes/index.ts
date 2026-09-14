import { Router } from 'express';
import type { AppContext } from '../context.js';
import { createActivityRouter } from './activity.routes.js';
import { createApprovalsRouter } from './approvals.routes.js';
import { createAgentsRouter } from './agents.routes.js';
import { createProjectsRouter } from './projects.routes.js';
import { createStreamRouter } from './stream.routes.js';
import { createTasksRouter } from './tasks.routes.js';
import { createWorldRouter } from './world.routes.js';

/** Mounts every route under /api. */
export function createApiRouter(ctx: AppContext): Router {
  const router = Router();

  router.use('/', createWorldRouter(ctx));
  router.use('/', createStreamRouter(ctx));
  router.use('/agents', createAgentsRouter(ctx));
  router.use('/projects', createProjectsRouter(ctx));
  router.use('/tasks', createTasksRouter(ctx));
  router.use('/approvals', createApprovalsRouter(ctx));
  router.use('/activity', createActivityRouter(ctx));

  return router;
}
