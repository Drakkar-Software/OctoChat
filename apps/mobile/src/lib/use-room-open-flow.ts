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
        // cap) because it is the cap issuer; non-owners use the soft read path. Computed once
        // here so BOTH the plaintext-invite branch and the E2EE branch below can use it.
        const isOwner = owner !== undefined && owner !== null && owner === session.userId;
        if (!enc) {
          // Plaintext room: no encryptor. Invite streams (objinvlog) are cap-gated and NOT
          // reachable by the space cap — present the per-node stream cap via getNodeStreamClient.
          // Public/space streams use the synchronous space client.
          let plainClient: StarfishClient;
          if (access === 'invite') {
            // objinvlog admits ONLY an owner-issued (delegated) cap or a narrow per-node cap —
            // the broad owner device cap is NOT honoured. getNodeStreamClient returns a working
            // cap only if a per-node entry is stored in THIS device's KV (saved at ticket
            // creation). When the caller IS the space owner but has no such entry — a different
            // device, or a ticket created elsewhere (e.g. by a desk bot) — re-mint the owner's
            // per-node objinvlog cap: the owner is the cap issuer, so this is always possible
            // and idempotent (mirrors the keyring self-heal in the E2EE branch below).
            if (isOwner) await ensureDeskTicketStreamAccess(session, spaceId, roomId);
            plainClient = getNodeStreamClient(spaceId, roomId, session) as unknown as StarfishClient;
          } else {
            plainClient = getSpaceClient(spaceId, session) as unknown as StarfishClient;
          }
          if (!cancelled) {
            setEncryptor(null);
            setClient(plainClient);
            finishOpening();
          }
          return;
        }
        // E2EE room: open the keyring (cached per space; offline from pull cache). For an
        // invite+enc node (E2EE ticket) the SDK opens the PER-NODE keyring; for space-tier enc
        // it opens the space-wide keyring — passing `access` selects which.
        // When the caller is the known owner, use the minting path (getNodeAccess) so a space
        // created before Fix A self-heals on first open — the owner's chatClient has space:owner
        // permission and ownerEnsureKeyring is idempotent. For all other callers, use the soft
        // path (buildNodeAccess) which returns null instead of throwing when access is unavailable.
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
