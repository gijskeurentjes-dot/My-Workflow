import type { Response } from 'express';
import type { ZodError, ZodSchema } from 'zod';
import { WorkflowError } from '../errors.js';
import type { AppContext } from '../context.js';
import type { EngineChanges } from '../services/agents/agent-engine.js';

/**
 * Run a command, broadcast whatever it changed, and answer.
 *
 * Every write goes through here, so no route can change the world without the
 * connected browsers hearing about it.
 */
export function command<T>(
  ctx: AppContext,
  res: Response,
  run: () => { changes: EngineChanges; body: T },
  status = 200,
): void {
  try {
    const { changes, body } = run();
    ctx.publish(changes);
    res.status(status).json(body);
  } catch (err) {
    if (err instanceof WorkflowError) {
      // A refused transition is the expected answer to an illegal request, not
      // a server fault — report the rule, not a stack trace.
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}

/** Parse a body, or answer 400 with what was wrong. Returns null when invalid. */
export function parseBody<T>(schema: ZodSchema<T>, body: unknown, res: Response): T | null {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  res.status(400).json({
    error: firstIssue(parsed.error),
    details: parsed.error.flatten(),
  });
  return null;
}

/** The first validation problem, phrased for a person rather than a form. */
function firstIssue(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'That request was not valid.';
  const field = issue.path.join('.');
  return field ? `${field}: ${issue.message}` : issue.message;
}
