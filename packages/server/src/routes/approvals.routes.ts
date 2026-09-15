import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { command, parseBody } from './helpers.js';

const listQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
});

const rejectBody = z.object({
  /** Why it is going back. Shown to the agent and written to the log. */
  note: z.string().max(500).optional(),
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

  router.post('/:id/approve', (req, res) => {
    command(ctx, res, () => ({
      changes: ctx.workflow.approve(req.params.id),
      body: ctx.repos.approvals.findById(req.params.id),
    }));
  });

  router.post('/:id/reject', (req, res) => {
    const body = parseBody(rejectBody, req.body ?? {}, res);
    if (!body) return;
    command(ctx, res, () => ({
      changes: ctx.workflow.reject(req.params.id, body.note),
      body: ctx.repos.approvals.findById(req.params.id),
    }));
  });

  /**
   * Withdraw the request and call the work off.
   *
   * Its own endpoint rather than a flag on reject, because they are different
   * answers: "no, do not do that" leaves the agent working, and "stop" ends it.
   */
  router.post('/:id/cancel', (req, res) => {
    const body = parseBody(rejectBody, req.body ?? {}, res);
    if (!body) return;
    command(ctx, res, () => ({
      changes: ctx.workflow.cancelApproval(req.params.id, body.note),
      body: ctx.repos.approvals.findById(req.params.id),
    }));
  });

  /** One request in full, for a deep link into the queue. */
  router.get('/:id', (req, res) => {
    const approval = ctx.repos.approvals.findById(req.params.id);
    if (!approval) {
      res.status(404).json({ error: 'Approval request not found' });
      return;
    }
    res.json(approval);
  });

  return router;
}
