/**
 * Pre-warms the space-wide E2EE keyring for the **active space** while the user
 * is looking at the rooms list, so the first room open doesn't pay the
 * `spaces/{spaceId}/_keyring` network round-trip + per-epoch crypto on the tap.
 *
 * How it works
 * ─────────────
 * `buildNodeAccessShared` caches its result keyed `{userId}:{spaceId}` for all
 * non-invite E2EE rooms (`node-access-cache.ts`). The first E2EE room opened in
 * a space fires that pull+crypto; every later room hits the resolved cache
 * synchronously. This hook fires the exact same `buildNodeAccessShared` call one
 * beat earlier — while the rooms list is visible — so the cache is already warm
 * when the user taps.
 *
 * Safety
 * ──────
 * - Only ONE space is warmed at a time (the active one). Warming across spaces
 *   concurrently would risk the server's rate limiter (HTTP 429).
 * - `buildNodeAccessShared`'s in-flight Map dedupes: a tap that races the warm
 *   joins the same Promise rather than firing a second pull.
 * - Deferred behind `InteractionManager.runAfterInteractions` so it doesn't
 *   compete with the cold-start render burst.
 * - A failed warm (offline, owner-needs-mint) removes the spaceId from `warmed`
 *   so the real `useRoomOpen` self-heals as usual.
 */
import { useEffect, useRef } from 'react';
import { InteractionManager } from 'react-native';

import { buildNodeAccessShared } from '@drakkar.software/octochat-sdk';
import type { Room } from '@drakkar.software/octochat-sdk';
import { useSession } from './session-context';

/**
 * Pre-warm the space-wide E2EE keyring for `spaceId`.
 *
 * @param spaceId  The active space id, or null when no space is selected.
 * @param rooms    The flat room list for the space (from `useRooms(spaceId).rooms`).
 */
export function useWarmKeyring(spaceId: string | null, rooms: Room[]): void {
  const { session } = useSession();

  // Track which spaces have already been warmed this session so switching back
  // to a space doesn't re-schedule (the SDK cache already dedupes, but this
  // avoids churning the effect / scheduling a task unnecessarily).
  const warmed = useRef<Set<string>>(new Set());

  // Pick a single representative non-invite, enc room. Warming ANY enc room in
  // the space warms the space-wide keyring (cache key is {userId}:{spaceId}).
  // Derive a stable primitive so the effect doesn't re-fire on every unread tick
  // (the rooms array identity changes on every `{...r, unread}` re-spread).
  const enc = rooms.find(
    (r) => r.access !== 'invite' && r.access !== 'public' && r.enc !== false,
  );
  const encRoomId = enc?.id ?? null;
  const encAccess = enc?.access; // 'space' | undefined — both map to space-wide keyring

  useEffect(() => {
    if (!session || !spaceId || !encRoomId) return;
    if (warmed.current.has(spaceId)) return;

    // Mark as warmed BEFORE the async work so a rapid space-switch doesn't
    // schedule a second task for the same space before the first fires.
    warmed.current.add(spaceId);

    const task = InteractionManager.runAfterInteractions(() => {
      void buildNodeAccessShared(session, spaceId, encRoomId, { access: encAccess, enc: true }).catch(() => {
        // Warm failed (offline / missing keyring for owner self-heal path).
        // Remove from warmed so the real useRoomOpen can self-heal on first tap.
        warmed.current.delete(spaceId);
      });
    });

    return () => task.cancel();
  }, [session, spaceId, encRoomId, encAccess]);
}
