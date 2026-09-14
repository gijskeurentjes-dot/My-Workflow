import { useEffect, useState } from 'react';
import { useWorldContext } from './WorldProvider.js';

/**
 * A clock that ticks on every animation frame, corrected for server skew.
 *
 * The world view uses it to interpolate walks between the server's 2 Hz
 * updates. It respects `prefers-reduced-motion` by falling back to a slow
 * interval — bots still move, they just do not animate.
 */
export function useAnimationClock(active = true): number {
  const { serverNow } = useWorldContext();
  const [now, setNow] = useState(() => serverNow());

  useEffect(() => {
    if (!active) return;

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced) {
      const timer = setInterval(() => setNow(serverNow()), 1000);
      return () => clearInterval(timer);
    }

    let raf = 0;
    const loop = () => {
      setNow(serverNow());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, serverNow]);

  return now;
}

/** A low-frequency clock, for "3 minutes ago" labels that need no smoothness. */
export function useSlowClock(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
