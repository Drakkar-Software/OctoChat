/**
 * Per-room latest-activity timestamps — the server epoch-ms of the most recent
 * room-change SSE event observed for each room in this session.
 *
 * Stored as a module-level singleton (same pattern as `dm-activity.ts` / `dmHeads`)
 * so it can be consumed via `useSyncExternalStore` in `use-dms.ts` without wiring
 * it through the unread context. Benefits vs. the old `useState`-in-UnreadProvider:
 *
 *  1. The SSE handler no longer calls `setLatestByRoom`, which triggered an extra
 *     provider re-render on every room event (even for the actively-viewed room
 *     where the unread count doesn't bump).
 *  2. `use-dms.ts` re-sorts immediately via `useSyncExternalStore` even when a
 *     viewed room advances — previously those advances were silently missed because
 *     the deps-list only contained the stable `latestActivityAt` callback.
 *  3. Other consumers of `useUnread()` (room lists, threads, etc.) are fully
 *     isolated from activity-timestamp updates.
 *
 * Mirrors `dm-activity.ts`: a `heads`-style record, `emit()`, `subscribe/get` pair.
 */

import { kvGet, kvSet } from '@drakkar.software/octochat-sdk';

// ── Module state ─────────────────────────────────────────────────────────────────

/** Per-room latest-activity timestamp (room id → server epoch-ms). Max-merged. */
let activity: Record<string, number> = {};
const listeners = new Set<() => void>();

/** The kv key for the current identity's persisted activity map. */
let activeKey: string | null = null;

// ── Internal helpers ──────────────────────────────────────────────────────────────

function emit(next: Record<string, number>): void {
  activity = next;
  for (const l of listeners) l();
}

// ── Public reads (for useSyncExternalStore) ───────────────────────────────────────

/** The current activity map — synchronous snapshot for `useSyncExternalStore`. */
export function getLatestActivity(): Record<string, number> {
  return activity;
}

/** Subscribe to activity-map changes (drives `useSyncExternalStore`). */
export function subscribeLatestActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Latest-activity timestamp for a single room (0 if no SSE event observed). */
export function getLatestActivityAt(roomId: string): number {
  return activity[roomId] ?? 0;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────────

/**
 * Warm the store from the persisted kv snapshot for this identity. Called once
 * from UnreadProvider's hydration effect so DM sort order survives reloads.
 */
export async function hydrateLatestActivity(userId: string): Promise<void> {
  activeKey = `octochat.latestactivity.${userId}`;
  const raw = await kvGet(activeKey).catch(() => null);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    // Max-merge into the current map (may already have live SSE events if hydration
    // races with the SSE subscription — the later timestamp wins).
    let changed = false;
    const next = { ...activity };
    for (const [roomId, ts] of Object.entries(parsed)) {
      if (Number.isFinite(ts) && ts > (next[roomId] ?? 0)) {
        next[roomId] = ts;
        changed = true;
      }
    }
    if (changed) emit(next);
  } catch {
    // corrupt kv — ignore, the next live SSE event re-seeds
  }
}

/**
 * Advance a room's activity timestamp (called from the SSE handler).
 * Max-merges — only advances, never rolls back. Persists to kv so the sort
 * order survives reloads. No-op if `ts` is not newer than the current value.
 * Requires `hydrateLatestActivity` to have been called first so `activeKey` is set.
 */
export function advanceRoomActivity(roomId: string, ts: number): void {
  if (ts <= (activity[roomId] ?? 0)) return;
  const next = { ...activity, [roomId]: ts };
  emit(next);
  if (activeKey) void kvSet(activeKey, JSON.stringify(next)).catch(() => {});
}

/**
 * Clear the activity map on sign-out so a fresh session never inherits the
 * prior one's sort order.
 */
export function resetLatestActivity(): void {
  activity = {};
  activeKey = null;
  emit(activity);
}
