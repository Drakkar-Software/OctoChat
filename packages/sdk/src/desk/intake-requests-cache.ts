/**
 * Module-level SWR (stale-while-revalidate) cache for the user's pending inbox requests.
 *
 * The inbox is a single document keyed by `userId`; `spaceIds` is an in-memory filter
 * applied AFTER the scan. The transport disables its own read-cache for inbox pulls
 * (`appendField:"items"` → `cacheKey = undefined`) so the dedup path never fires there.
 * Caching the RESULT here avoids the mount+foreground+poll triple-fire without
 * request-level dedup.
 *
 * NOT a fetch-dedup — two concurrent stale callers each revalidate independently.
 * This is intentional (dedup = ugly design per explicit project constraint).
 *
 * Cache shape: one entry per userId — the most-recent scan result + the time it was
 * taken + the sorted space-key it was computed for (a changed space-set bypasses TTL).
 *
 * Lifecycle: call {@link clearInboxRequestsCache} in `resetAccountScopedState` in
 * `session-context.tsx` alongside the other module-level resets.
 */

import type { PendingRequest } from '@drakkar.software/starfish-spaces';

import type { Session } from '../starfish/identity';
import { listPendingTicketRequestsForSpaces } from './intake';

interface Entry {
  at: number;
  spaceKey: string;
  value: PendingRequest[];
}

const cache = new Map<string, Entry>();

/** TTL before a cached result is considered stale and a background revalidation fires (2 min). */
export const INBOX_REQUESTS_TTL_MS = 120_000;

/**
 * SWR read of the owner's pending requests across `spaceIds` in ONE inbox scan.
 *
 * - **fresh** (within TTL, same space-set) → return cached; no network.
 * - **stale** (present but past TTL, same space-set) → return cached NOW, revalidate in
 *   the background, then call `onRevalidated(fresh)` so the caller can repaint.
 * - **cold / space-set changed** → await a fresh scan, cache and return it.
 *
 * `spaceKey = [...spaceIds].sort().join(',')` — a changed space-set (join / create) bypasses
 * the TTL so pending requests for new spaces surface immediately.
 */
export async function readPendingRequestsSWR(
  session: Session,
  spaceIds: ReadonlySet<string>,
  onRevalidated?: (fresh: PendingRequest[]) => void,
): Promise<PendingRequest[]> {
  const userId = session.userId;
  const spaceKey = [...spaceIds].sort().join(',');
  const now = Date.now();
  const entry = cache.get(userId);

  if (entry && entry.spaceKey === spaceKey) {
    if (now - entry.at < INBOX_REQUESTS_TTL_MS) {
      // Fresh — serve cached; no network.
      return entry.value;
    }
    // Stale — return cached NOW and revalidate in the background.
    void listPendingTicketRequestsForSpaces(session, spaceIds).then((fresh) => {
      cache.set(userId, { at: Date.now(), spaceKey, value: fresh });
      onRevalidated?.(fresh);
    });
    return entry.value;
  }

  // Cold or space-set changed — await a fresh scan, cache and return.
  const fresh = await listPendingTicketRequestsForSpaces(session, spaceIds);
  cache.set(userId, { at: Date.now(), spaceKey, value: fresh });
  return fresh;
}

/**
 * Drop one request from the cached snapshot after an optimistic accept/decline.
 * Prevents the next within-window stale-serve from resurrecting the row the owner
 * just acted on.
 */
export function removePendingFromCache(userId: string, reqId: string): void {
  const entry = cache.get(userId);
  if (!entry) return;
  cache.set(userId, { ...entry, value: entry.value.filter((p) => p.req.reqId !== reqId) });
}

/**
 * Reset on account switch / sign-out. Called in `session-context.tsx`
 * `resetAccountScopedState` alongside the other module-level resets.
 */
export function clearInboxRequestsCache(): void {
  cache.clear();
}
