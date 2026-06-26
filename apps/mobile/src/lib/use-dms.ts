/**
 * The identity's Direct Messages, for the "Direct Messages" section in the room list +
 * desktop sidebar. Built from the DURABLE `dmSpaceIds` list (joined-spaces doc, same
 * source as rooms) UNIONED with the lossy `dms` peer-map, so the list is complete even
 * when the peer-map is empty/lagging on cold start (the primed snapshot carries no
 * `dms`; `healDmMap` is async). The per-entry name/avatar is resolved via a
 * `spaceId → peerUserId` reverse index from `dms`; spaces not yet in `dms` render a
 * hex-fallback monogram until the deferred `healDmMap` converges.
 *
 * Unread counts come from `unreadByRoom` keyed by `dmRoomId(spaceId)` — the same room
 * ids the SSE bump writes to — so the count is always consistent with what was bumped.
 * Logic lives here; section components just render.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { dmRoomId, getArchivedDms, isDmArchived, subscribeArchivedDms, totalDmUnread } from '@drakkar.software/octochat-sdk';
import { getDmHeads, refreshDmHeads, subscribeDmHeads } from '@drakkar.software/octochat-sdk';
import { usePseudos, useAvatars } from './use-pseudos';
import { useUnreadCounts } from './unread-context';
import { getLatestActivity, subscribeLatestActivity } from './latest-activity';
import { useDmMap, useSpacesContext } from './spaces-context';
import { useSession } from './session-context';

export interface DmEntry {
  spaceId: string;
  roomId: string;
  peerUserId: string;
  /** Peer's display name (their pseudo, or a hex fallback until it resolves). */
  name: string;
  /** Two-letter monogram for the DM avatar (fallback when no image). */
  initials: string;
  /** Peer's uploaded avatar (data URI), or undefined until it resolves. */
  image?: string;
  unread: number;
  /** True when the user has archived this DM (hidden from the active list). A DM with
   *  unread > 0 is always shown regardless — auto-resurface backstop. */
  archived: boolean;
}

/**
 * The DM list, sorted by most-recent activity (newest-first). Primary sort key is the
 * latest SSE room-change timestamp from `latestActivityAt` (persisted across reloads
 * via kv); ties break on peer name alphabetically so unranked DMs stay stable.
 *
 * NOTE (POC): the SSE stream has no replay, so cold-start recency comes only from the
 * kv cache. A DM whose last message predates this feature shipping sorts alphabetically
 * until its next live event.
 */
export function useDms(): DmEntry[] {
  const dms = useDmMap();
  const { dmSpaceIds } = useSpacesContext();

  // Durable DM space set UNIONED with the lossy peer-map's spaces — the same union
  // the SSE candidate set uses — so the list shows every DM that can receive a live
  // bump, even before healDmMap populates `dms`.
  const spaceIds = useMemo(
    () => [...new Set<string>([...dmSpaceIds, ...Object.values(dms)])],
    [dmSpaceIds, dms],
  );

  // Known peer ids (from the lossy map) — used as the prefetch input for pseudos /
  // avatars. A superset is harmless: unused peer ids resolve to a cache miss, not an
  // error. `spaceIds` may include entries not yet in `dms`; they get a hex fallback.
  const peerIds = useMemo(() => Object.keys(dms), [dms]);
  const pseudo = usePseudos(peerIds);
  // Same shared profile cache as pseudos — no extra request — so the DM row shows
  // the peer's real picture (image with monogram fallback), like the chat avatar.
  const avatar = useAvatars(peerIds);
  const { unreadByRoom } = useUnreadCounts();

  // space → peer reverse index from the (lossy) map. A space in dmSpaceIds but not
  // yet healed into `dms` has no peer here; its row falls back to a hex name until
  // the deferred healDmMap maps it (same cache-first-then-heal posture as the primed
  // paint in SpacesProvider).
  const peerBySpace = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [peer, sid] of Object.entries(dms)) m[sid] = peer;
    return m;
  }, [dms]);

  // Subscribe to archive-set changes via the module-level store (no provider needed —
  // archived-dms.ts is a singleton like mutes.ts). The snapshot reference changes on
  // every toggle, so this is the minimal dependency for recompute.
  const _archivedDms = useSyncExternalStore(subscribeArchivedDms, getArchivedDms, getArchivedDms);
  // Authoritative DM head timestamps (server-assigned, cross-device consistent). Used
  // as the primary sort key so web and mobile sort DMs identically. The snapshot
  // reference changes whenever `refreshDmHeads` advances any head, so recompute fires.
  const dmHeads = useSyncExternalStore(subscribeDmHeads, getDmHeads, getDmHeads);
  // Latest SSE activity timestamp per room — module store, same pattern as dmHeads.
  // useSyncExternalStore ensures the DM list re-sorts even when a currently-viewed
  // room advances its timestamp (which doesn't bump the unread count).
  const latestActivity = useSyncExternalStore(subscribeLatestActivity, getLatestActivity, getLatestActivity);

  // `pseudo` reads a module cache the React Compiler can't track; the joined ids,
  // unread map, latest-activity, and archived-set drive recompute.
  return useMemo(() => {
    return spaceIds
      .map((spaceId): DmEntry => {
        const roomId = dmRoomId(spaceId);
        const peerUserId = peerBySpace[spaceId] ?? '';
        // Resolve the display name from the peer's pseudo when known; fall back to a
        // hex slug derived from the DM space id (`dm-<hex>` → first 6 chars of hex)
        // until healDmMap has mapped the peer. This matches the pattern used for
        // identity fallbacks elsewhere in the app.
        const name = peerUserId
          ? (pseudo(peerUserId) ?? `octo-${peerUserId.slice(0, 6)}`)
          : `octo-${spaceId.slice(3, 9)}`; // 'dm-<hex>' → hex prefix fallback
        return {
          spaceId,
          roomId,
          peerUserId,
          name,
          initials: name.slice(0, 2).toUpperCase(),
          image: peerUserId ? avatar(peerUserId) : undefined,
          unread: unreadByRoom[roomId] ?? 0,
          archived: isDmArchived(spaceId),
        };
      })
      // Primary: authoritative server head ts (cross-device consistent) MAX-merged with
      // live SSE ts (instant reorder on a new message without waiting for a refresh).
      // Both are 0 when absent, so an unranked DM sorts to the end alphabetically.
      // Tiebreak: peer name asc so unranked DMs keep a stable alphabetical order.
      .sort((a, b) => {
        const rankB = Math.max(dmHeads[b.roomId] ?? 0, latestActivity[b.roomId] ?? 0);
        const rankA = Math.max(dmHeads[a.roomId] ?? 0, latestActivity[a.roomId] ?? 0);
        const tsDiff = rankB - rankA;
        if (tsDiff !== 0) return tsDiff;
        return a.name.localeCompare(b.name);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceIds, peerBySpace, unreadByRoom, latestActivity, _archivedDms, dmHeads, pseudo, avatar]);
}

/**
 * Total unread across every DM — the virtual DM space's rail-tile badge count.
 *
 * Reads the DURABLE `dmSpaceIds` list (same source the SSE subscription and
 * `unreadBySpace` use) unioned with the lossy peer-map's spaces, so the total is
 * correct even when the peer-map is empty on cold start. Uses the pure
 * `totalDmUnread` SDK helper which is independently unit-tested.
 */
export function useTotalDmUnread(): number {
  const { dmSpaceIds, dms } = useSpacesContext();
  const { unreadByRoom } = useUnreadCounts();
  return useMemo(
    () => totalDmUnread(dmSpaceIds, dms, unreadByRoom),
    [dmSpaceIds, dms, unreadByRoom],
  );
}

/**
 * Refresh authoritative DM head timestamps while the DM list is on screen.
 *
 * Call from `<DmList>` so the per-DM `?last=1` head pulls fire ONLY when the DM
 * list is actually rendered, not on every space-rooms load / navigation / foreground.
 * The SDK's 15s throttle + in-flight coalescing absorb mount churn; re-fires when
 * the DM set changes (a new DM conversation was created).
 *
 * Uses the DURABLE `dmSpaceIds` (same source as `useDms`) so it refreshes heads for
 * exactly the DMs that are shown, even when the lossy peer-map is lagging.
 */
export function useRefreshDmHeads(): void {
  const { session } = useSession();
  const { dmSpaceIds } = useSpacesContext();
  // Stable string key: re-fires the effect only when the set of DM space ids changes,
  // not on every unrelated context re-render.
  const key = dmSpaceIds.join(',');
  useEffect(() => {
    if (!session || dmSpaceIds.length === 0) return;
    void refreshDmHeads(session, dmSpaceIds).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, key]);
}
