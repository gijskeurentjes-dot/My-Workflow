import { API_BASE, type WorldSnapshot } from '@ai-islands/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

  if (!res.ok) {
    // The API reports failures as { error }, but a proxy or a crash can return
    // HTML — fall back to the status line rather than throwing a parse error.
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Body was not JSON; the status message is the best we have.
    }
    throw new ApiError(message, res.status);
  }

  return (await res.json()) as T;
}

export const api = {
  world: () => request<WorldSnapshot>('/world'),

  /** Wipe the world and replay the demo seed. Returns the fresh snapshot. */
  resetDemoData: () => request<WorldSnapshot>('/reset', { method: 'POST' }),
};
