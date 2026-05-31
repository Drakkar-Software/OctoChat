/**
 * Shared room-open effect for {@link ./use-room} (merge-doc) and {@link ./use-stream-room}
 * (append-only). Both resolve the same crypto context the same way:
 *  - PUBLIC space: no keyring/encryptor — authorize with the invite cap (joiner) or the
 *    account cap (owner) via {@link publicSpaceAuth} and build a plain client.
 *  - PRIVATE space (E2EE): open the space keyring encryptor (cached per space; offline
 *    from the SDK pull cache) and its room client.
 * Builds on {@link useRoomOpenState} for the opening/error/offline flags + reconnect.
 *
 * The ONLY divergence is `initializeRoom`: a merge-doc owner open must seed the room doc
 * (`ensureRoomInitialized`); an append-only stream has no merge doc to seed and passes
 * `false`. Reachability is NOT reported here — building the encryptor may have used the
 * cache (offline); the caller reports it from its first fresh pull.
 */
import { useEffect, useState } from 'react';
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import { ensureRoomInitialized, makeClient } from './starfish/client';
import { getMemberCap } from './starfish/member-caps';
import { getSpaceEncryptor } from './starfish/space-encryptor';
import { publicSpaceAuth } from './starfish/pubspace';
import { useRoomsRegistryActions } from './rooms-registry-context';
import { useSession } from './session-context';
import { useRoomOpenState } from './use-room-open';

export interface RoomOpenFlow {
  encryptor: Encryptor | null;
  client: StarfishClient | null;
  opening: boolean;
  openError: string | null;
  offline: boolean;
  reload: () => void;
}

export function useRoomOpen(opts: {
  roomId: string;
  spaceId: string;
  isPublic: boolean;
  enabled: boolean;
  /** Merge-doc owner opens seed the room doc; append-only streams pass false. */
  initializeRoom?: boolean;
}): RoomOpenFlow {
  const { roomId, spaceId, isPublic, enabled, initializeRoom = false } = opts;
  const { session } = useSession();
  const { ensure: ensureRegistry } = useRoomsRegistryActions();
  const [encryptor, setEncryptor] = useState<Encryptor | null>(null);
  const [client, setClient] = useState<StarfishClient | null>(null);
  const { opening, openError, offline, reloadNonce, reload, beginOpen, finishOpening, failOpen } =
    useRoomOpenState();

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset room crypto/open state before reopening when room or session changes
    setEncryptor(null);
    setClient(null);
    beginOpen();
    if (!enabled || !session) return;
    (async () => {
      try {
        if (isPublic) {
          // Public space: no keyring, no encryptor. Authorize with the invite cap
          // (joiner) or the account cap (owner) — see publicSpaceAuth.
          const auth = publicSpaceAuth(session, spaceId);
          if (!cancelled) {
            setEncryptor(null);
            setClient(makeClient(auth.cap, auth.signingKey));
            finishOpening(); // public open did no network call — proves no reachability
          }
          return;
        }
        // PRIVATE: the keyring is space-wide (cached per space; see getSpaceEncryptor),
        // the room doc is per-room. With no stored member cap we need the registry owner
        // for the owner-vs-no-access decision — read it once via the SHARED rooms registry
        // rather than a private `readRooms`, so the room screen and sidebar don't each
        // pull it.
        const reg = getMemberCap(spaceId) ? null : await ensureRegistry(spaceId);
        const { encryptor: enc, client: roomClient, isOwnerOpen } = await getSpaceEncryptor(spaceId, session, reg);
        // `ensureRoomInitialized` is per-ROOM and merge-doc-only — an append-only stream
        // has no doc to seed, so it opts out via `initializeRoom: false`.
        if (isOwnerOpen && initializeRoom) await ensureRoomInitialized(session.chatClient, enc, roomId);
        if (!cancelled) {
          setEncryptor(enc);
          setClient(roomClient);
          // NOTE: no openReached() — building the encryptor may have used the cached
          // keyring (offline). Reachability is reported from the caller's first fresh pull.
          finishOpening();
        }
      } catch (e) {
        if (!cancelled) failOpen(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, session, roomId, spaceId, isPublic, initializeRoom, ensureRegistry, reloadNonce, beginOpen, finishOpening, failOpen]);

  return { encryptor, client, opening, openError, offline, reload };
}
