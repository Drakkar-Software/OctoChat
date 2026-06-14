/**
 * Shared room-open effect for the append-only chat {@link ./use-room} and the generic
 * merge-doc {@link ./use-merge-doc} (Work docs/projects). Both resolve the same crypto
 * context the same way:
 *  - Plaintext room (`enc === false`): use {@link getSpaceClient} — no network call,
 *    resolves immediately from the cached member cap.
 *  - E2EE room (`enc === true`): open the space-wide keyring encryptor via
 *    {@link buildNodeAccess} (cached per space; offline from the SDK pull cache).
 * Builds on {@link useRoomOpenState} for the opening/error/offline flags + reconnect.
 *
 * No room-doc seeding: every chat room is an append-only log that pulls as [] until its
 * first append. Reachability is NOT reported here — building the encryptor may have used
 * the cache (offline); the caller reports it from its first fresh pull.
 */
import { useEffect, useState } from 'react';
import type { Encryptor } from '@drakkar.software/starfish-client';

import { makeClient } from '@drakkar.software/octochat-sdk';

// Derive StarfishClient from the SDK's `makeClient` to keep the nominal type consistent
// across symlinked packages (see original comment in the file this replaced).
type StarfishClient = ReturnType<typeof makeClient>;
import { getSpaceClient, buildNodeAccess, SpaceAccessError } from '@drakkar.software/octochat-sdk';
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
  /** True when the room's content is E2EE (sealed with the space-wide keyring). */
  enc: boolean;
  enabled: boolean;
}): RoomOpenFlow {
  const { roomId, spaceId, enc, enabled } = opts;
  const { session } = useSession();
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
        if (!enc) {
          // Plaintext room: the space client handles auth, no encryptor needed.
          // getSpaceClient is synchronous — no network call, proves no reachability.
          const spaceClient = getSpaceClient(spaceId, session) as unknown as StarfishClient;
          if (!cancelled) {
            setEncryptor(null);
            setClient(spaceClient);
            finishOpening();
          }
          return;
        }
        // E2EE room: open the space-wide keyring (cached per space; offline from pull cache).
        // buildNodeAccess is a soft resolve — returns null if no access is available.
        const access = await buildNodeAccess(session, spaceId, roomId, { enc: true });
        if (!access) throw new SpaceAccessError(`No access to room ${roomId}.`);
        if (!cancelled) {
          setEncryptor(access.encryptor as unknown as Encryptor);
          setClient(access.client as unknown as StarfishClient);
          finishOpening();
        }
      } catch (e) {
        if (!cancelled) failOpen(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, session, roomId, spaceId, enc, reloadNonce, beginOpen, finishOpening, failOpen]);

  return { encryptor, client, opening, openError, offline, reload };
}
