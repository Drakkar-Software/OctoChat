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
import { createUnionMerge, SyncManager } from '@drakkar.software/starfish-client';
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import { makeClient } from './starfish/client';
import type { Session } from './starfish/identity';
import { getSpaceEncryptor } from './starfish/space-encryptor';
import { isPublicSpaceId, publicSpaceAuth } from './starfish/pubspace';
import {
  pubspaceRoomPull,
  pubspaceRoomPush,
  pubstreamRoomPush,
  roomPull,
  roomPush,
  streamRoomPush,
} from './starfish/paths';
import type { StoredMsg } from './message-view';
import type { OutboxMessage } from './outbox';

type EncryptFn = { encrypt: (d: Record<string, unknown>) => Promise<Record<string, unknown>> };

/** Resolve the sync client (+ encryptor for a private space) for an entry's space.
 *  Mirrors the open branches of `useRoom`/`useStreamRoom`: a public space authorizes
 *  with the invite/account cap and has no encryptor; a private space opens the cached
 *  space keyring encryptor. Rejects if the space key isn't available (→ retried). */
async function resolveContext(
  session: Session,
  entry: OutboxMessage,
): Promise<{ client: StarfishClient; encryptor: Encryptor | null }> {
  if (isPublicSpaceId(entry.spaceId)) {
    const auth = publicSpaceAuth(session, entry.spaceId);
    return { client: makeClient(auth.cap, auth.signingKey), encryptor: null };
  }
  // `reg: null` — by the time a message was queued the room was open, so a joined
  // space's member cap is hydrated (getSpaceEncryptor reads it) and an owned space
  // resolves via the owner branch. The per-space cache usually makes this a hit.
  const { encryptor, client } = await getSpaceEncryptor(entry.spaceId, session, null);
  return { client, encryptor };
}

export async function sendQueued(session: Session, entry: OutboxMessage): Promise<void> {
  const { client, encryptor } = await resolveContext(session, entry);
  const isPublic = isPublicSpaceId(entry.spaceId);

  const msg: StoredMsg = { id: entry.id, authorId: entry.authorId, ts: entry.ts, text: entry.text };
  if (entry.parentId) msg.parentId = entry.parentId;

  if (entry.kind === 'stream') {
    // Append-only log: seal for a private stream, plaintext for a public one.
    const env = { t: 'msg', e: msg } as unknown as Record<string, unknown>;
    const body = encryptor ? await (encryptor as unknown as EncryptFn).encrypt(env) : env;
    const pushPath = isPublic
      ? pubstreamRoomPush(publicSpaceAuth(session, entry.spaceId).ownerId, entry.spaceId, entry.roomId)
      : streamRoomPush(entry.roomId);
    await client.append(pushPath, body);
    return;
  }

  // Merge-doc room (channel / dm / private). Mirror useSyncInit: a SyncManager with
  // the same paths/encryptor/union-merge — and, like it, NO signer (OctoChat's live
  // pushes attach none). Pull first to seed the doc + hash, then append our message.
  const ownerId = isPublic ? publicSpaceAuth(session, entry.spaceId).ownerId : '';
  const sm = new SyncManager({
    client,
    pullPath: isPublic ? pubspaceRoomPull(ownerId, entry.spaceId, entry.roomId) : roomPull(entry.roomId),
    pushPath: isPublic ? pubspaceRoomPush(ownerId, entry.spaceId, entry.roomId) : roomPush(entry.roomId),
    ...(encryptor ? { encryptor } : {}),
    onConflict: createUnionMerge(),
  });
  await sm.pull();
  await sm.update((d) => {
    const msgs = (d.messages as unknown[]) ?? [];
    return { ...d, messages: [...msgs, msg as unknown as Record<string, unknown>] };
  });
}
