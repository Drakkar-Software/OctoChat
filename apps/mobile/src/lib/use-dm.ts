/**
 * The "Message <user>" action + its availability, for the profile screen.
 *
 * A DM is only offerable when (a) the peer is not yourself, (b) you share a PRIVATE
 * space (the carrier for delivering the invite — see `starfish/dm.ts`), and (c) the
 * peer has published their identity keys. The hook resolves all three for a given peer
 * and exposes a single `status` the thin profile page maps onto button visibility.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';

import { useSession } from './session-context';
import { useSpacesContext } from './spaces-context';
import { createOrOpenDm, dmRoomId, findSharedSpaceWith } from '@drakkar.software/octochat-sdk';
import { readPeerKeys, type PeerKeys } from '@drakkar.software/octochat-sdk';

/**
 * - `self` — this is your own profile (hide the button).
 * - `checking` — still resolving shared space / keys.
 * - `no-shared-space` — you don't share a private space with them (hide).
 * - `no-keys` — shared space exists, but they haven't published keys yet (disable).
 * - `ready` — a DM can be opened.
 */
export type DmStatus = 'self' | 'checking' | 'no-shared-space' | 'no-keys' | 'ready';

export interface UseDm {
  status: DmStatus;
  busy: boolean;
  error: string | null;
  /** Open (creating if needed) the DM and navigate to it. `peerPseudo` names the room
   *  + DM space. No-op unless `status === 'ready'`. */
  openDm: (peerPseudo: string) => Promise<void>;
}

export function useDm(peerUserId: string): UseDm {
  const { session } = useSession();
  const { spaces, refresh } = useSpacesContext();
  const [status, setStatus] = useState<DmStatus>('checking');
  const [sharedSpaceId, setSharedSpaceId] = useState<string | null>(null);
  const [peerKeys, setPeerKeys] = useState<PeerKeys | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSelf = !!session && peerUserId === session.userId;
  // Stable key so the resolve effect re-runs when the joinable space set changes
  // (e.g. after joining a space with this peer), not on every spaces array identity.
  const spacesKey = useMemo(() => spaces.map((s) => s.id).join(','), [spaces]);

  useEffect(() => {
    if (!session) return;
    if (isSelf) {
      setStatus('self');
      return;
    }
    let cancelled = false;
    setStatus('checking');
    void (async () => {
      try {
        const shared = await findSharedSpaceWith(session, peerUserId, spaces);
        if (cancelled) return;
        setSharedSpaceId(shared);
        if (!shared) {
          setStatus('no-shared-space');
          return;
        }
        const keys = await readPeerKeys(peerUserId);
        if (cancelled) return;
        setPeerKeys(keys);
        setStatus(keys ? 'ready' : 'no-keys');
      } catch {
        if (!cancelled) setStatus('no-shared-space');
      }
    })();
    return () => {
      cancelled = true;
    };
    // spacesKey stands in for `spaces`; session identity + peer are the other inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, peerUserId, isSelf, spacesKey]);

  const openDm = useCallback(
    async (peerPseudo: string) => {
      if (!session || !sharedSpaceId || !peerKeys) return;
      setBusy(true);
      setError(null);
      try {
        const { roomId } = await createOrOpenDm(session, peerUserId, peerKeys, peerPseudo, sharedSpaceId);
        await refresh(); // surface the new DM in the Direct Messages section
        router.push({ pathname: '/room/[id]', params: { id: roomId, name: peerPseudo, kind: 'dm' } });
      } catch {
        setError('Couldn’t start this DM. Please try again.');
      } finally {
        setBusy(false);
      }
    },
    [session, sharedSpaceId, peerKeys, peerUserId, refresh],
  );

  return { status, busy, error, openDm };
}

/** Convenience: the room id of a DM space (re-export so screens don't reach into
 *  `starfish/dm` for this one helper). */
export { dmRoomId };
