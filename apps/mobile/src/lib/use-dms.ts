/**
 * The identity's Direct Messages, for the "Direct Messages" section in the room list +
 * desktop sidebar. Built from the `dms` map (peer userId → DM space id) overlaid with
 * the peer's display pseudo (viewer-correct — each side sees the OTHER participant) and
 * the DM room's live unread count. Logic lives here; the section component just renders.
 */
import { useMemo } from 'react';

import { usePseudos, useAvatars } from './use-pseudos';
import { useUnread } from './unread-context';
import { useDmMap } from './spaces-context';
import { dmRoomId } from './starfish/dm';

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
}

/** The DM list, sorted by peer name for a stable order. */
export function useDms(): DmEntry[] {
  const dms = useDmMap();
  const peerIds = useMemo(() => Object.keys(dms), [dms]);
  const pseudo = usePseudos(peerIds);
  // Same shared profile cache as pseudos — no extra request — so the DM row shows
  // the peer's real picture (image with monogram fallback), like the chat avatar.
  const avatar = useAvatars(peerIds);
  const { unreadByRoom } = useUnread();

  // `pseudo` reads a module cache the React Compiler can't track; the joined ids +
  // unread map drive recompute, and consumers churn enough to pick up a late pseudo.
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
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerIds, dms, unreadByRoom, pseudo, avatar]);
}

/** Total unread across every DM — the virtual DM space's rail-tile badge count. */
export function useTotalDmUnread(): number {
  const dms = useDms();
  return useMemo(() => dms.reduce((n, d) => n + d.unread, 0), [dms]);
}
