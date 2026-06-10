/**
 * The "Message <user>" action + its availability, for the profile screen.
 *
 * A DM is offerable to ANY peer who isn't you and has published their identity
 * keys — no shared space required. Delivery picks the cheapest channel: if you
 * already share a PRIVATE space, the invite rides that space's carrier
 * (`createOrOpenDm`); otherwise it goes through the peer's per-recipient inbox
 * (`createOrOpenDmViaInbox`, the same path a "DM me" link uses). The hook resolves
 * keys (+ an optional shared space) and exposes a single `status` the thin profile
 * page maps onto button visibility.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';

import { useSession } from './session-context';
import { useSpacesContext } from './spaces-context';
import { createOrOpenDm, createOrOpenDmViaInbox, dmRoomId, findSharedSpaceWith } from '@drakkar.software/octochat-sdk';
import { readPeerKeys, type PeerKeys } from '@drakkar.software/octochat-sdk';

/**
 * - `self` — this is your own profile (hide the button).
 * - `checking` — still resolving keys / shared space.
 * - `no-keys` — they haven't published identity keys yet, so no DM is possible (disable).
 * - `ready` — a DM can be opened (via a shared-space carrier or the peer's inbox).
 */
export type DmStatus = 'self' | 'checking' | 'no-keys' | 'ready';

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
        // Keys are the gate (the DM is sealed to them); a shared space only picks
        // the cheaper delivery channel, it's no longer required.
        const [keys, shared] = await Promise.all([
          readPeerKeys(peerUserId),
          findSharedSpaceWith(session, peerUserId, spaces).catch(() => null),
        ]);
        if (cancelled) return;
        setPeerKeys(keys);
        setSharedSpaceId(shared);
        setStatus(keys ? 'ready' : 'no-keys');
      } catch {
        if (!cancelled) setStatus('no-keys');
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
      if (!session || !peerKeys) return;
      setBusy(true);
      setError(null);
      try {
        // Prefer the shared-space carrier when one exists (no public-inbox write);
        // otherwise deliver through the peer's inbox — works with no space in common.
        const { roomId } = sharedSpaceId
          ? await createOrOpenDm(session, peerUserId, peerKeys, peerPseudo, sharedSpaceId)
          : await createOrOpenDmViaInbox(session, { userId: peerUserId, ...peerKeys }, peerPseudo);
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
