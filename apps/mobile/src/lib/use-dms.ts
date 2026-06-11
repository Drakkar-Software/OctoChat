/**
 * The identity's Direct Messages, for the "Direct Messages" section in the room list +
 * desktop sidebar. Built from the `dms` map (peer userId → DM space id) overlaid with
 * the peer's display pseudo (viewer-correct — each side sees the OTHER participant),
 * the DM room's live unread count, the per-room latest-activity timestamp (for recency
 * sort), and whether the DM is archived (hidden unless the user shows archived).
 * Logic lives here; the section component just renders.
 */
import { useMemo, useSyncExternalStore } from 'react';

import { dmRoomId, getArchivedDms, isDmArchived, subscribeArchivedDms } from '@drakkar.software/octochat-sdk';
import { usePseudos, useAvatars } from './use-pseudos';
import { useUnread } from './unread-context';
import { useDmMap } from './spaces-context';

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
  const peerIds = useMemo(() => Object.keys(dms), [dms]);
  const pseudo = usePseudos(peerIds);
  // Same shared profile cache as pseudos — no extra request — so the DM row shows
  // the peer's real picture (image with monogram fallback), like the chat avatar.
  const avatar = useAvatars(peerIds);
  const { unreadByRoom, latestActivityAt } = useUnread();
  // Subscribe to archive-set changes via the module-level store (no provider needed —
  // archived-dms.ts is a singleton like mutes.ts). The snapshot reference changes on
  // every toggle, so this is the minimal dependency for recompute.
  const _archivedDms = useSyncExternalStore(subscribeArchivedDms, getArchivedDms, getArchivedDms);

  // `pseudo` reads a module cache the React Compiler can't track; the joined ids,
  // unread map, latest-activity, and archived-set drive recompute.
  return useMemo(() => {
    return peerIds
      .map((peerUserId): DmEntry => {
        const spaceId = dms[peerUserId];
        const roomId = dmRoomId(spaceId);
        const name = pseudo(peerUserId) ?? `octo-${peerUserId.slice(0, 6)}`;
        return {
          spaceId,
          roomId,
          peerUserId,
          name,
          initials: name.slice(0, 2).toUpperCase(),
          image: avatar(peerUserId),
          unread: unreadByRoom[roomId] ?? 0,
          archived: isDmArchived(spaceId),
        };
      })
      // Primary: most-recent SSE event desc (0 = no event yet → sorts to end).
      // Tiebreak: peer name asc so unranked DMs keep a stable alphabetical order.
      .sort((a, b) => {
        const tsDiff = latestActivityAt(b.roomId) - latestActivityAt(a.roomId);
        if (tsDiff !== 0) return tsDiff;
        return a.name.localeCompare(b.name);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerIds, dms, unreadByRoom, latestActivityAt, _archivedDms, pseudo, avatar]);
}

/** Total unread across every DM — the virtual DM space's rail-tile badge count. */
export function useTotalDmUnread(): number {
  const dms = useDms();
  return useMemo(() => dms.reduce((n, d) => n + d.unread, 0), [dms]);
}
