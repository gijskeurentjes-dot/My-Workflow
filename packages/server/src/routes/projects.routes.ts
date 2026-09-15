import { Router } from 'express';
import { z } from 'zod';
import {
  ARCHETYPE_KEYS,
  PROJECT_TEMPLATES,
  type AgentArchetype,
  type ProjectTemplate,
} from '@ai-islands/shared';
import type { AppContext } from '../context.js';
import { command, parseBody } from './helpers.js';

const listQuery = z.object({
  status: z.enum(['active', 'paused', 'archived']).optional(),
});

const createBody = z.object({
  // A deal room can be created without a name: the template supplies one.
  name: z.string().max(120).optional(),
  description: z.string().max(600).optional(),
  /** Which kind of project. A deal room brings its own fixed team of five. */
  template: z
    .enum(PROJECT_TEMPLATES as unknown as [ProjectTemplate, ...ProjectTemplate[]])
    .optional(),
  /** Who to hire onto the new project. Defaults to a project manager. */
  team: z.array(z.enum(ARCHETYPE_KEYS as [AgentArchetype, ...AgentArchetype[]])).max(8).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a hex value like #4a8ff0')
    .optional(),
});

const updateBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(600).optional(),
    status: z.enum(['active', 'paused', 'archived']).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export function createProjectsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }

    const projects = ctx.repos.projects.list(parsed.data);
    // Each card shows counts, so compute them here rather than making the
    // client fetch every task just to render a progress bar.
    res.json(
      projects.map((project) => {
        const tasks = ctx.repos.tasks.list({ projectId: project.id });
        return {
          ...project,
          agentCount: ctx.repos.agents.findByProject(project.id).length,
          taskCount: tasks.length,
          completedCount: tasks.filter((t) => t.status === 'completed').length,
          openCount: tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length,
          blockedCount: tasks.filter((t) => t.status === 'failed').length,
          awaitingApprovalCount: tasks.filter((t) => t.status === 'waiting_approval').length,
        };
      }),
    );
  });

  router.get('/:id', (req, res) => {
    const project = ctx.repos.projects.findById(req.params.id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({
      project,
      agents: ctx.world.listAgentViews(project.id),
      tasks: ctx.world.listTaskViews({ projectId: project.id }),
      activity: ctx.world.listActivity({ projectId: project.id, limit: 40 }),
    });
  });

  router.post('/', (req, res) => {
    const body = parseBody(createBody, req.body, res);
    if (!body) return;
    command(
      ctx,
      res,
      () => {
        const { project, changes } = ctx.workflow.createProject(body);
        return { changes, body: project };
      },
      201,
    );
  });

  router.patch('/:id', (req, res) => {
    const body = parseBody(updateBody, req.body, res);
    if (!body) return;
    command(ctx, res, () => {
      const { project, changes } = ctx.workflow.updateProject(req.params.id, body);
      return { changes, body: project };
    });
  });

  router.delete('/:id', (req, res) => {
    command(ctx, res, () => ({
      changes: ctx.workflow.deleteProject(req.params.id),
      body: { ok: true },
    }));
  });

  return router;
}
