import { Router } from 'express';
import { z } from 'zod';
import { TASK_STATUSES, TASK_TYPE_KEYS, type TaskStatus, type TaskType } from '@ai-islands/shared';
import type { AppContext } from '../context.js';

const listQuery = z.object({
  projectId: z.string().optional(),
  islandId: z.string().optional(),
  botId: z.string().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  type: z.enum(TASK_TYPE_KEYS as [TaskType, ...TaskType[]]).optional(),
});

export function createTasksRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }

    const { status, ...rest } = parsed.data;
    res.json(ctx.world.listTaskViews({ ...rest, ...(status ? { status: status as TaskStatus } : {}) }));
  });

  router.get('/:id', (req, res) => {
    const task = ctx.world.findTaskView(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    res.json({
      task,
      activity: ctx.world.listActivity({ taskId: task.id, limit: 30 }),
      approval: ctx.repos.approvals.findPendingByTask(task.id),
    });
  });

  return router;
}
