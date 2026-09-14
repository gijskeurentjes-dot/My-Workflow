import type { Response } from 'express';
import type { ServerEvent } from '@ai-islands/shared';

/**
 * The Server-Sent Events hub.
 *
 * One instance owns every open stream. Anything that changes the world calls
 * `broadcast`, and connected browsers reduce the event into their local copy —
 * no polling, and no second way for state to reach the client.
 */
export class Broadcaster {
  private readonly clients = new Set<Response>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(private readonly heartbeatMs: number = 20_000) {}

  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Attach a response as a stream. Returns a detach function; the caller wires
   * it to the request's `close` event.
   */
  add(res: Response): () => void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tells nginx and friends not to buffer the stream into silence.
      'X-Accel-Buffering': 'no',
    });
    // Flush the headers so the browser fires `onopen` straight away.
    res.flushHeaders?.();
    // Suggest a reconnect delay to EventSource's built-in retry.
    res.write('retry: 3000\n\n');

    this.clients.add(res);
    this.ensureHeartbeat();

    return () => this.remove(res);
  }

  private remove(res: Response): void {
    this.clients.delete(res);
    if (this.clients.size === 0 && this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  /** Send one event to a single stream — used for the initial snapshot. */
  send(res: Response, event: ServerEvent): void {
    this.write(res, event);
  }

  /** Send one event to every open stream. */
  broadcast(event: ServerEvent): void {
    for (const res of this.clients) this.write(res, event);
  }

  private write(res: Response, event: ServerEvent): void {
    try {
      // Named events let a client subscribe selectively. Note that a named
      // event does NOT reach `onmessage` — a listener must be registered for
      // the name. `SERVER_EVENT_TYPES` is the list clients iterate to do that.
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    } catch {
      // A stream that has already gone away is not an error worth raising;
      // drop it and carry on serving everyone else.
      this.remove(res);
    }
  }

  private ensureHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      this.broadcast({ type: 'heartbeat', at: Date.now() });
    }, this.heartbeatMs);
    this.heartbeat.unref?.();
  }

  /** Close every stream. Called on shutdown. */
  closeAll(): void {
    for (const res of this.clients) {
      try {
        res.end();
      } catch {
        // Already closed — nothing to do.
      }
    }
    this.clients.clear();
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}
