/**
 * Pure helpers for DM unread-count aggregation and cold-start seeding.
 *
 * Extracted from the React layer so they can be unit-tested without a DOM / React
 * runtime. The two functions mirror the pattern of `reconcileReads` in
 * `unread-context.tsx`: they take plain objects in, return a new map (or null for
 * no-op), and never touch any store/setState directly.
 *
 * Background: a DM unread count is bumped by the live SSE stream exactly like a
 * regular room (`unreadByRoom[roomId] += 1`). The historical bug was on the READ
 * side — the old aggregation iterated the LOSSY `dms` peer-map, which is empty /
 * lagging on cold start (the primed snapshot carries no `dms` and `healDmMap` is
 * async). The durable `dmSpaceIds` list (from the joined-spaces doc, same as rooms)
 * is always populated early and is the correct source.
 */

import type { DmMap } from '../domain/types';
import { dmRoomId } from '../starfish/dm-ids';

/**
 * Sum unread counts across every DM conversation, over the DURABLE `dmSpaceIds`
 * list UNIONED with the (lossy) peer-map's space ids.
 *
 * This is the same candidate set the SSE subscription uses (`unreadByRoom` is bumped
 * for these room ids and nobody else), so the returned total is always consistent
 * with what actually got bumped — even when the peer-map is empty or lagging on cold
 * start.
 *
 * De-duplicates the union so an id present in both sources is counted only once.
 *
 * @param dmSpaceIds  Durable list from the joined-spaces doc (primary, reliable early).
 * @param dms         Lossy peer→space index (belt-and-suspenders for newly-healed DMs).
 * @param unreadByRoom  Current per-room unread map from `UnreadProvider`.
 */
export function totalDmUnread(
  dmSpaceIds: string[],
  dms: DmMap,
  unreadByRoom: Record<string, number>,
): number {
  let total = 0;
  for (const spaceId of new Set<string>([...dmSpaceIds, ...Object.values(dms)])) {
    total += unreadByRoom[dmRoomId(spaceId)] ?? 0;
  }
  return total;
}

/**
 * Compute a seed patch for DM conversations that have unread messages the SSE stream
 * never replayed (first / pre-subscription messages that arrived before the space was
 * subscribed — the stream has no replay on reconnect).
 *
 * Compares the authoritative DM head timestamp (`getDmHeads()`, keyed by room id)
 * against the synced read mark (`getReadPrefs().nodes`, same keying): if a head is
 * newer than the read mark AND no live count exists yet, seeds the room to `1`
 * ("at least one unread" — the count model has no per-message totals; live SSE bumps
 * accumulate beyond this seed on subsequent messages).
 *
 * Returns the NEXT counts map when anything changes, or `null` when nothing needs
 * seeding — idempotent:
 * - a DM already read (`read ≥ head`) is skipped.
 * - a room with an existing live count is skipped (no clobber, no double-count).
 * - re-running after `markRoomRead` clears the count and the read mark advances past
 *   the head, so the seed never reappears after a read.
 *
 * @param dmSpaceIds  Durable DM space ids to check.
 * @param heads       Output of `getDmHeads()`: `{ [roomId]: serverTsMs }`.
 * @param reads       Output of `getReadPrefs().nodes`: `{ [roomId]: lastReadTsMs }`.
 * @param counts      Current `unreadByRoom` (from `mapRef.current` in UnreadProvider).
 */
export function computeDmUnreadSeed(
  dmSpaceIds: string[],
  heads: Record<string, number>,
  reads: Record<string, number>,
  counts: Record<string, number>,
): Record<string, number> | null {
  let changed = false;
  const next = { ...counts };
  for (const spaceId of dmSpaceIds) {
    const roomId = dmRoomId(spaceId);
    if ((heads[roomId] ?? 0) > (reads[roomId] ?? 0) && !next[roomId]) {
      next[roomId] = 1;
      changed = true;
    }
  }
  return changed ? next : null;
}
