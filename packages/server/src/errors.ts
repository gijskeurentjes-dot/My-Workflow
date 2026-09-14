/**
 * A command the world refused.
 *
 * Carries the HTTP status so routes stay thin: the rule lives with the state
 * machine that enforces it, not duplicated in a handler.
 */
export class WorkflowError extends Error {
  constructor(
    message: string,
    readonly status: number = 409,
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

export const notFound = (what: string): WorkflowError => new WorkflowError(`${what} not found`, 404);

export const refuse = (why: string): WorkflowError => new WorkflowError(why, 409);

export const invalid = (why: string): WorkflowError => new WorkflowError(why, 400);
