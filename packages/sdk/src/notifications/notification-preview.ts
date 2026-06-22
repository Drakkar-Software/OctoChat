/**
 * Build a decrypted one-line preview ("Name: message") for a notification, by
 * pulling a room's latest messages on demand. Driven by the `preview` notification
 * setting and used only where the app renders the toast itself (web/desktop — see
 * `notify.ts`); native banners are OS-rendered from the generic FCM payload and can't
 * be rewritten.
 *
 * Every room is an append-only log: plaintext for public rooms (`streampub`), E2EE for
 * encrypted rooms (`streamchat`), or plaintext cap-gated for invite rooms (`streaminv`).
 * We fold a bounded TAIL of the log via the shared {@link pullAndFold} — the preview only
 * needs the latest line — then format the newest previewable message. Any failure (no
 * keyring yet, server unreachable, no recent text message) returns null so the caller
 * shows the generic "New message" banner instead.
 */
import { getSpaceClient } from '@drakkar.software/octospaces-sdk';
import { buildNodeAccessShared } from '../starfish/node-access-cache';
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import { resolveEdit, type StoredMsg } from '../format/message-view';
import { readPseudo } from '../starfish/client';
import type { Session } from '../starfish/identity';
import { readIndexRooms } from '../starfish/object-index';
import { objIndexPull, spaceIdFromRoomId } from '../starfish/paths';
import { roomStreamPull } from '../messaging/room-paths';
import { pullAndFold } from '../messaging/stream-log';
import type { MessageEditEvent } from '../domain/types';

/** Hard cap on preview length so a long message can't overflow the OS toast. */
const PREVIEW_MAX_CHARS = 140;

/** How many trailing log elements to fold for the preview. */
const PREVIEW_TAIL = 24;

function clip(text: string): string {
  const t = text.trim();
  return t.length > PREVIEW_MAX_CHARS ? `${t.slice(0, PREVIEW_MAX_CHARS - 1)}…` : t;
}

/**
 * Pick the newest previewable message from a folded log and format it as
 * "Name: text", or null when there's nothing to show (all own / deleted / textless).
 */
async function latestSenderLine(
  messages: StoredMsg[],
  edits: MessageEditEvent[],
  selfId: string,
): Promise<string | null> {
  for (const m of [...messages].sort((a, b) => b.ts - a.ts)) {
    if (m.authorId === selfId) continue;
    const edit = resolveEdit(edits, m.id, m.authorId);
    if (edit?.kind === 'delete') continue;
    const text = edit?.kind === 'edit' ? edit.text : m.text;
    if (text && text.trim()) {
      const name = (await readPseudo(m.authorId).catch(() => null))?.trim() || m.authorId.slice(0, 8);
      return `${name}: ${clip(text)}`;
    }
  }
  return null;
}

export async function loadLatestMessagePreview(
  session: Session,
  roomId: string,
  spaceId?: string,
): Promise<string | null> {
  // Prefer the caller-supplied space id (the SSE event / FCM payload carries it). Deriving
  // the space from the room id is LOSSY: it returns a bogus space for `ticket-<hex>` ids
  // (no embedded space), which would fail every read here. See spaceIdFromRoomId.
  const sid = spaceId ?? spaceIdFromRoomId(roomId);

  try {
    // Read the object index (always plaintext) to determine the room's access tier.
    const spaceClient = getSpaceClient(sid, session);
    const rooms = (await readIndexRooms(spaceClient, null, objIndexPull(sid), sid))?.rooms ?? [];
    const room = rooms.find((r) => r.id === roomId);

    // Route by access tier: public → streampub; invite+enc:false → streaminv; else → streamchat.
    // `room` is undefined on an index miss → roomStreamPull falls through to streamchat.
    let client: StarfishClient = spaceClient;
    let enc: Encryptor | null = null;
    const pullPath = roomStreamPull(room, roomId);

    if (room === undefined) {
      // Index miss (cold start / index lag — fresh device, first notification after install).
      // We can't determine the room's access tier, so we fall back to streamchat. If the
      // notified user holds a space keyring (the dominant case: they're a member who got a
      // push), buildNodeAccess returns an encryptor and we get a real decrypted preview.
      // If it returns null (public/invite room with no keyring — unlikely for a push target,
      // but safe), we continue with enc=null and fanOut of sealed blobs → null preview →
      // the generic "New message" banner. Mirrors cross-room.ts which always probes the keyring.
      const access = await buildNodeAccessShared(session, sid, roomId, { enc: true }).catch(() => null);
      if (access) {
        client = access.client;
        enc = access.encryptor;
      }
    } else if (room.enc) {
      const access = await buildNodeAccessShared(session, sid, roomId, { enc: true }).catch(() => null);
      if (!access) return null;
      client = access.client;
      enc = access.encryptor;
    }

    const { data } = await pullAndFold(client, enc, pullPath, { appendField: 'items', last: PREVIEW_TAIL });
    return latestSenderLine(data.messages, data.edits, session.userId);
  } catch {
    return null; // no keyring yet / unreachable / nothing previewable → generic banner
  }
}
