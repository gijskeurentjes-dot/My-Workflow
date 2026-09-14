import { Router } from 'express';
import type { AppContext } from '../context.js';

/**
 * The Server-Sent Events endpoint.
 *
 * A client connects once and receives a snapshot immediately, then deltas as
 * the world moves. There is no polling endpoint on purpose: one path for live
 * state means the UI cannot drift between two sources.
 */
export function createStreamRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/stream', (req, res) => {
    // Long-lived: never let a default response timeout kill the stream.
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true);

    const detach = ctx.broadcaster.add(res);

    ctx.broadcaster.send(res, {
      type: 'snapshot',
      at: Date.now(),
      world: ctx.world.snapshot(),
    });

    req.on('close', detach);
  });

  return router;
}
