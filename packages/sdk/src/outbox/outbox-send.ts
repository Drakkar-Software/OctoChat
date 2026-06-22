/**
 * Headless send for a queued {@link OutboxMessage} — the authoritative,
 * attempt-driven send used by the flusher ({@link ./outbox-context}). Unlike the
 * room hooks' `send`, this needs NO mounted screen: it rebuilds the room's crypto
 * context from the session (reusing the very helpers the hooks' open effects use),
 * so a message queued in room A still goes out while the user sits in room B or has
 * just relaunched the app.
 *
 * It REJECTS on any network/crypto failure — the flusher removes the entry only on
 * a resolved send, so a failure cleanly leaves it queued for retry. The sent
 * message carries the entry's own `id`/`ts`, so it lands in the room store under
 * the same id the pending bubble used (dedup-by-id ⇒ no duplicate).
 */
import { getSpaceClient, getNodeStreamClient } from '@drakkar.software/octospaces-sdk';
import { buildNodeAccessShared } from '../starfish/node-access-cache';
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import type { Session } from '../starfish/identity';
import { readIndexRooms } from '../starfish/object-index';
import { objIndexPull, objInvLogPush, streamPubRoomPush, streamRoomPush } from '../starfish/paths';
import type { StoredMsg } from '../format/message-view';
import type { OutboxMessage } from './outbox-types';

type EncryptFn = { encrypt: (d: Record<string, unknown>) => Promise<Record<string, unknown>> };

type RoomTier = { access?: string; enc?: boolean };

/** Inner resolution once the room tier is known. */
async function resolveRoomContext(
  session: Session,
  entry: OutboxMessage,
  room: RoomTier,
): Promise<{ client: StarfishClient; encryptor: Encryptor | null; pushPath: string }> {
  if (room.enc) {
    // Pass `access` so the SDK opens the PER-NODE keyring for invite+enc (E2EE tickets)
    // instead of the space-wide keyring.
    const access = await buildNodeAccessShared(session, entry.spaceId, entry.roomId, { access: room.access as Parameters<typeof buildNodeAccessShared>[3]['access'], enc: true });
    if (!access) throw new Error('No keyring access for room');
    // An E2EE ticket (invite+enc) seals with the node keyring but its log lives in the
    // cap-gated invite stream (objinvlog) — append via the per-node stream cap client.
    if (room.access === 'invite') {
      return {
        client: getNodeStreamClient(entry.spaceId, entry.roomId, session),
        encryptor: access.encryptor,
        pushPath: objInvLogPush(entry.spaceId, entry.roomId),
      };
    }
    return { client: access.client, encryptor: access.encryptor, pushPath: streamRoomPush(entry.roomId) };
  }

  // Route plaintext rooms by access tier: public → streampub; invite → objinvlog; else → streamchat.
  // Invite streams (objinvlog) are cap-gated, NOT reachable by the space cap — present the
  // per-node stream cap via getNodeStreamClient so the ticket requester (and members, once
  // granted) can actually post. Use entry.spaceId explicitly (ticket ids have no embedded space).
  if (room.access === 'invite') {
    return {
      client: getNodeStreamClient(entry.spaceId, entry.roomId, session),
      encryptor: null,
      pushPath: objInvLogPush(entry.spaceId, entry.roomId),
    };
  }
  const spaceClient = getSpaceClient(entry.spaceId, session);
  const pushPath = room.access === 'public' ? streamPubRoomPush(entry.roomId) : streamRoomPush(entry.roomId);
  return { client: spaceClient, encryptor: null, pushPath };
}

/** Resolve the sync client, encryptor, and push path for an entry's room.
 *  For invite rooms (`entry.access === 'invite'`) the index read is skipped entirely —
 *  the user may not be a space member (ticket requester) and so cannot read `_index`.
 *  For all other rooms the object index is read (always plaintext) to learn the access
 *  tier + enc flag. Rejects on any failure so the flusher retries. */
async function resolveContext(
  session: Session,
  entry: OutboxMessage,
): Promise<{ client: StarfishClient; encryptor: Encryptor | null; pushPath: string }> {
  // Fast path: invite rooms (tickets / shared rooms). Skip the _index read — the
  // requester may not be a space member. enc defaults to false; the enc:true case is
  // handled the same way via buildNodeAccessShared inside resolveRoomContext.
  if (entry.access === 'invite') {
    return resolveRoomContext(session, entry, { access: 'invite', enc: false });
  }

  const spaceClient = getSpaceClient(entry.spaceId, session);
  // Throw if the index is unreachable — message stays queued for retry. Falling
  // through to a plaintext branch when the room might be enc:true would silently
  // post unencrypted content.
  const rooms = (await readIndexRooms(spaceClient, null, objIndexPull(entry.spaceId), entry.spaceId))?.rooms;
  if (!rooms) throw new Error('Room index unavailable — will retry');
  const room = rooms.find((r) => r.id === entry.roomId);
  if (!room) throw new Error('Room not found in index — will retry');
  return resolveRoomContext(session, entry, room);
}

export async function sendQueued(session: Session, entry: OutboxMessage): Promise<void> {
  const { client, encryptor, pushPath } = await resolveContext(session, entry);

  const msg: StoredMsg = { id: entry.id, authorId: entry.authorId, ts: entry.ts, text: entry.text };
  if (entry.parentId) msg.parentId = entry.parentId;

  // Every room is an append-only log. Seal the `{t,e}` envelope for E2EE rooms;
  // send plaintext for public/plaintext rooms. Then APPEND — no pull/merge/hash.
  const env = { t: 'msg', e: msg } as unknown as Record<string, unknown>;
  const body = encryptor ? await (encryptor as unknown as EncryptFn).encrypt(env) : env;
  await client.append(pushPath, body);
}
