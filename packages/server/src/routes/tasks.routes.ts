import { Router } from 'express';
import { z } from 'zod';
import { TASK_STATUSES, TASK_TYPE_KEYS, type TaskStatus, type TaskType } from '@ai-islands/shared';
import type { AppContext } from '../context.js';
import { command, parseBody } from './helpers.js';

const listQuery = z.object({
  projectId: z.string().optional(),
  islandId: z.string().optional(),
  botId: z.string().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  type: z.enum(TASK_TYPE_KEYS as [TaskType, ...TaskType[]]).optional(),
});

const createBody = z.object({
  projectId: z.string().min(1, 'Pick a project'),
  title: z.string().min(1, 'A task needs a title').max(160),
  notes: z.string().max(1000).optional(),
  type: z.enum(TASK_TYPE_KEYS as [TaskType, ...TaskType[]]),
  needsApproval: z.boolean().optional(),
  botId: z.string().nullable().optional(),
  /** Assign and start in one step, instead of leaving it on the board. */
  autoStart: z.boolean().optional(),
});

const updateBody = z
  .object({
    title: z.string().min(1).max(160).optional(),
    notes: z.string().max(1000).optional(),
    needsApproval: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

const assignBody = z.object({ botId: z.string().min(1, 'Pick an agent') });

export function createTasksRouter(ctx: AppContext): Router {
  const router = Router();

  // ── Reads ───────────────────────────────────────────────────────────────

  router.get('/', (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }
    const { status, ...rest } = parsed.data;
    res.json(
      ctx.world.listTaskViews({ ...rest, ...(status ? { status: status as TaskStatus } : {}) }),
    );
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

  // ── Writes ──────────────────────────────────────────────────────────────

  router.post('/', (req, res) => {
    const body = parseBody(createBody, req.body, res);
    if (!body) return;
    command(
      ctx,
      res,
      () => {
        const { task, changes } = ctx.workflow.createTask(body);
        return { changes, body: task };
      },
      201,
    );
  });

  router.patch('/:id', (req, res) => {
    const body = parseBody(updateBody, req.body, res);
    if (!body) return;
    command(ctx, res, () => {
      const { task, changes } = ctx.workflow.updateTask(req.params.id, body);
      return { changes, body: task };
    });
  });

  router.delete('/:id', (req, res) => {
    command(ctx, res, () => ({
      changes: ctx.workflow.deleteTask(req.params.id),
      body: { ok: true },
    }));
  });

  // ── Actions ─────────────────────────────────────────────────────────────
  // Each is its own endpoint rather than a status field a client could set to
  // anything: the legal transitions stay on the server, where they belong.

  router.post('/:id/assign', (req, res) => {
    const body = parseBody(assignBody, req.body, res);
    if (!body) return;
    command(ctx, res, () => ({
      changes: ctx.workflow.assignTask(req.params.id, body.botId),
      body: ctx.world.findTaskView(req.params.id),
    }));
  });

  router.post('/:id/unassign', (req, res) => {
    command(ctx, res, () => ({
      changes: ctx.workflow.unassignTask(req.params.id),
      body: ctx.world.findTaskView(req.params.id),
    }));
  });

  for (const [path, run] of [
    ['start', (id: string) => ctx.workflow.startTask(id)],
    ['pause', (id: string) => ctx.workflow.pauseTask(id)],
    ['cancel', (id: string) => ctx.workflow.cancelTask(id)],
    ['retry', (id: string) => ctx.workflow.retryTask(id)],
    ['reset', (id: string) => ctx.workflow.resetTask(id)],
  ] as const) {
    router.post(`/:id/${path}`, (req, res) => {
      command(ctx, res, () => ({
        changes: run(req.params.id),
        body: ctx.world.findTaskView(req.params.id),
      }));
    });
  }

  return router;
}
