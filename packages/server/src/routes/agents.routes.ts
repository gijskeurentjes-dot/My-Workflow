import { Router } from 'express';
import { z } from 'zod';
import { ARCHETYPE_KEYS, type AgentArchetype } from '@ai-islands/shared';
import type { AppContext } from '../context.js';
import { command, parseBody } from './helpers.js';

const listQuery = z.object({ projectId: z.string().optional() });

const hireBody = z.object({
  projectId: z.string().min(1, 'Pick a project'),
  archetype: z.enum(ARCHETYPE_KEYS as [AgentArchetype, ...AgentArchetype[]]),
  name: z.string().max(80).optional(),
});

const updateBody = z
  .object({
    name: z.string().min(1).max(80).optional(),
    role: z.string().max(120).optional(),
    /** What a real engine would send as this agent's system prompt. */
    instructions: z.string().max(8000).optional(),
    tools: z.array(z.string().min(1).max(80)).max(32).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export function createAgentsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }
    res.json(ctx.world.listAgentViews(parsed.data.projectId));
  });

  router.get('/:id', (req, res) => {
    const agent = ctx.world.findAgentView(req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json({
      agent,
      // The agent's own history, which is what the detail panel shows.
      activity: ctx.world.listActivity({ agentId: agent.id, limit: 30 }),
      tasks: ctx.world.listTaskViews({ assignedAgentId: agent.id }),
    });
  });

  router.post('/', (req, res) => {
    const body = parseBody(hireBody, req.body, res);
    if (!body) return;
    command(
      ctx,
      res,
      () => {
        const { agent, changes } = ctx.workflow.hireAgent(body.projectId, body.archetype, body.name);
        return { changes, body: agent };
      },
      201,
    );
  });

  router.patch('/:id', (req, res) => {
    const body = parseBody(updateBody, req.body, res);
    if (!body) return;
    command(ctx, res, () => {
      const { agent, changes } = ctx.workflow.updateAgent(req.params.id, body);
      return { changes, body: agent };
    });
  });

  router.delete('/:id', (req, res) => {
    command(ctx, res, () => ({
      changes: ctx.workflow.dismissAgent(req.params.id),
      body: { ok: true },
    }));
  });

  return router;
}
