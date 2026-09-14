import { Router } from 'express';
import type { AppContext } from '../context.js';
import { hasAgentCredentials } from '../config.js';
import { runtimeInfo } from '../services/agents/claude/runners.js';
import { command } from './helpers.js';
import { refuse } from '../errors.js';

/**
 * Running a task against a real agent.
 *
 * Execution is a POST because it spends money and changes the world, and it is
 * its own endpoint rather than a flag on start so that "simulate this" and
 * "actually run this" can never be confused for one another.
 */
export function createExecutionRouter(ctx: AppContext): Router {
  const router = Router();

  // Whether a live run is possible, and on what. Never the key itself.
  router.get('/runtime', (_req, res) => {
    res.json(runtimeInfo());
  });

  router.post('/tasks/:id/run', (req, res) => {
    command(ctx, res, () => {
      if (!hasAgentCredentials()) {
        throw refuse(
          'No ANTHROPIC_API_KEY is configured, so no real agent can run. See the README for how to set one.',
        );
      }

      // `execute` resolves when the run finishes, which is far longer than a
      // request should be held open. Start it, answer immediately, and let the
      // event stream carry the rest.
      void ctx.execution.execute(req.params.id).catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[agent] run failed after it started:', error);
      });

      return {
        changes: { agents: [], tasks: [], activity: [], approvals: [], projectsChanged: false, approvalsChanged: false },
        body: { started: true, taskId: req.params.id },
      };
    }, 202);
  });

  router.post('/tasks/:id/stop', (req, res) => {
    const stopped = ctx.execution.cancel(req.params.id);
    if (!stopped) {
      res.status(409).json({ error: 'That task is not running.' });
      return;
    }
    res.json({ stopped: true, taskId: req.params.id });
  });

  router.get('/tasks/:id/results', (req, res) => {
    const task = ctx.repos.tasks.findById(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(ctx.repos.results.listByTask(task.id));
  });

  return router;
}
