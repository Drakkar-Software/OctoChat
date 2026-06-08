/**
 * Shared room-open effect for the append-only chat {@link ./use-room} and the generic
 * merge-doc {@link ./use-merge-doc} (Work docs/projects). Both resolve the same crypto
 * context the same way:
 *  - PUBLIC space: no keyring/encryptor — authorize with the invite cap (joiner) or the
 *    account cap (owner) via {@link publicSpaceAuth} and build a plain client.
 *  - PRIVATE space (E2EE): open the space keyring encryptor (cached per space; offline
 *    from the SDK pull cache) and its room client.
 * Builds on {@link useRoomOpenState} for the opening/error/offline flags + reconnect.
 *
 * No room-doc seeding: every chat room is an append-only log that pulls as [] until its
 * first append (and merge-doc objects seed their own index elsewhere). Reachability is
 * NOT reported here — building the encryptor may have used the cache (offline); the
 * caller reports it from its first fresh pull.
 */
import { useEffect, useState } from 'react';
import type { Encryptor } from '@drakkar.software/starfish-client';

import { makeClient } from '@drakkar.software/octochat-sdk';

// Derive StarfishClient from the SDK's `makeClient` rather than importing it from
// `@drakkar.software/starfish-client` directly. With the local pnpm-link symlinks, the
// same specifier resolves to two distinct declarations of `StarfishClient` (which has a
// `private baseUrl`, making it nominally incompatible): the app's symlink → satellite
// source, but the SDK → the root published copy. Anchoring the type to the SDK's own
// `makeClient`/`getSpaceEncryptor` return keeps this hook's client type identical to the
// values it stores and to the SDK consumers it feeds (attachments etc.).
type StarfishClient = ReturnType<typeof makeClient>;
import { getMemberCap } from '@drakkar.software/octochat-sdk';
import { getSpaceEncryptor } from '@drakkar.software/octochat-sdk';
import { publicSpaceAuth } from '@drakkar.software/octochat-sdk';
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
}): RoomOpenFlow {
  const { roomId, spaceId, isPublic, enabled } = opts;
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
        const { encryptor: enc, client: roomClient } = await getSpaceEncryptor(spaceId, session, reg);
        // No room-doc seed: an append-only room has no doc to initialize (it pulls as []
        // until its first append).
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
  }, [enabled, session, roomId, spaceId, isPublic, ensureRegistry, reloadNonce, beginOpen, finishOpening, failOpen]);

  return { encryptor, client, opening, openError, offline, reload };
}
