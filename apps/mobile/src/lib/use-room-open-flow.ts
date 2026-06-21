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
import { getSpaceClient, getNodeStreamClient, ensureDeskTicketStreamAccess, buildNodeAccess, getNodeAccess, SpaceAccessError } from '@drakkar.software/octochat-sdk';
import type { NodeAccess } from '@drakkar.software/octochat-sdk';
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
  /** The room's access tier — invite-plaintext streams (objinvlog) are cap-gated and
   *  reached via the per-node stream cap, not the space client. */
  access?: NodeAccess;
  enabled: boolean;
  /**
   * The space owner's userId if known. When provided and the caller IS the owner,
   * the room-open flow uses the minting path (`getNodeAccess`) to self-heal spaces
   * created before the eager-mint fix (Fix A) — backfilling a missing keyring on first
   * open so the owner is never permanently stuck.
   */
  owner?: string | null;
}): RoomOpenFlow {
  const { roomId, spaceId, enc, access, enabled, owner } = opts;
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
        // The space owner can self-heal missing per-node access (a keyring OR an objinvlog
        // cap) because it is the cap issuer; non-owners use the soft read path.
        const isOwner = owner !== undefined && owner !== null && owner === session.userId;

        // Invite rooms (OctoDesk tickets): the message LOG always lives in `objinvlog`,
        // reachable ONLY via the per-node STREAM cap — never the keyring/content client
        // getNodeAccess returns (that cap covers `objinv`, a DIFFERENT collection). So the
        // client is ALWAYS the stream client, for plaintext AND E2EE; only the encryptor
        // differs: none for plaintext, the per-node keyring for E2EE. The owner self-heals its
        // per-node objinvlog cap (it is the cap issuer, so this always succeeds and is
        // idempotent); non-owners use the cap stored at invite-accept. getNodeStreamClient
        // falls back to the broad device cap when no per-node entry exists — and that cap is
        // NOT honoured for objinvlog — which is exactly why the owner self-heal is required.
        if (access === 'invite') {
          if (isOwner) await ensureDeskTicketStreamAccess(session, spaceId, roomId);
          let inviteEncryptor: Encryptor | null = null;
          if (enc) {
            // E2EE ticket — open the per-node keyring for the encryptor only (the client stays
            // the stream client). Owner mints/ensures the keyring (getNodeAccess); everyone else
            // builds it softly from the stored keyring cap (null → no access → throw).
            const handle = isOwner
              ? await getNodeAccess(spaceId, roomId, { access, enc: true }, session, { owner, members: [] })
              : await buildNodeAccess(session, spaceId, roomId, { access, enc: true });
            if (!handle) throw new SpaceAccessError(`No access to room ${roomId}.`);
            inviteEncryptor = handle.encryptor as unknown as Encryptor;
          }
          const streamClient = getNodeStreamClient(spaceId, roomId, session) as unknown as StarfishClient;
          if (!cancelled) {
            setEncryptor(inviteEncryptor);
            setClient(streamClient);
            finishOpening();
          }
          return;
        }

        if (!enc) {
          // Plaintext public/space room: no encryptor, synchronous space client.
          const plainClient = getSpaceClient(spaceId, session) as unknown as StarfishClient;
          if (!cancelled) {
            setEncryptor(null);
            setClient(plainClient);
            finishOpening();
          }
          return;
        }
        // E2EE space/private room: open the space-wide keyring (cached per space; offline from
        // the pull cache). When the caller is the known owner, use the minting path
        // (getNodeAccess) so a space created before Fix A self-heals on first open — the owner's
        // contentClient has space:owner permission and ownerEnsureKeyring is idempotent. For all
        // other callers, use the soft path (buildNodeAccess) which returns null instead of
        // throwing when access is unavailable.
        let nodeAccess: { client: unknown; encryptor: unknown } | null;
        if (isOwner) {
          const handle = await getNodeAccess(spaceId, roomId, { access, enc: true }, session, {
            owner,
            members: [],
          });
          nodeAccess = { client: handle.client, encryptor: handle.encryptor };
        } else {
          nodeAccess = await buildNodeAccess(session, spaceId, roomId, { access, enc: true });
        }
        if (!nodeAccess) throw new SpaceAccessError(`No access to room ${roomId}.`);
        if (!cancelled) {
          setEncryptor(nodeAccess.encryptor as unknown as Encryptor);
          setClient(nodeAccess.client as unknown as StarfishClient);
          finishOpening();
        }
      } catch (e) {
        if (!cancelled) failOpen(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, session, roomId, spaceId, enc, access, owner, reloadNonce, beginOpen, finishOpening, failOpen]);

  return { encryptor, client, opening, openError, offline, reload };
}
