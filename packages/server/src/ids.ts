import { randomUUID } from 'node:crypto';

/**
 * Prefixed identifiers. The prefix makes ids self-describing in logs and in the
 * activity feed, and it costs nothing: everything downstream treats them as
 * opaque strings.
 */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}
