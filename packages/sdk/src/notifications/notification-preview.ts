/**
 * Build a decrypted one-line preview ("Name: message") for a notification, by
 * pulling a room's latest messages on demand. Driven by the `preview` notification
 * setting and used only where the app renders the toast itself (web/desktop — see
 * `notify.ts`); native banners are OS-rendered from the generic FCM payload and can't
 * be rewritten.
 *
 * Every room is an append-only log of `{t,e}` envelopes (sealed for a PRIVATE/E2EE
 * space, plaintext for a PUBLIC one). We fold a bounded TAIL of the log via the shared
 * {@link pullAndFold} — the preview only needs the latest line, so pulling/decrypting
 * the whole history would be wasteful — then format the newest previewable message. Any
 * failure (no keyring yet, server unreachable, no recent text message) returns null so
 * the caller shows the generic "New message" banner instead.
 */
import { buildSpaceEncryptor } from '../starfish/space-encryptor';
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import { resolveEdit, type StoredMsg } from '../format/message-view';
import { makeClient, readPseudo } from '../starfish/client';
import type { Session } from '../starfish/identity';
import { pubstreamRoomPull, spaceIdFromRoomId, streamRoomPull } from '../starfish/paths';
import { isPublicSpaceId, publicSpaceAuth } from '../starfish/pubspace';
import { pullAndFold } from '../messaging/stream-log';
import type { MessageEditEvent } from '../domain/types';

/** Hard cap on preview length so a long message can't overflow the OS toast. */
const PREVIEW_MAX_CHARS = 140;

/** How many trailing log elements to fold for the preview. The preview needs only the
 *  latest previewable message (+ a trailing edit/delete of it, which append AFTER it), so
 *  a small tail beats decrypting the whole log on every push. If the latest non-own
 *  message happens to fall outside this window, the preview returns null and the caller
 *  shows the generic banner — an acceptable miss for a best-effort preview. */
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
  // Newest first; fold each message's edit/delete log and take the first that still
  // has text (an attachment-only or deleted latest message falls through to generic).
  for (const m of [...messages].sort((a, b) => b.ts - a.ts)) {
    // Skip our own messages: a send from another device fires this room's SSE event
    // here, and "You: …" is a confusing thing to be notified about.
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

export async function loadLatestMessagePreview(session: Session, roomId: string): Promise<string | null> {
  const spaceId = spaceIdFromRoomId(roomId);

  // Resolve the read route by space type: a PUBLIC room is plaintext (no encryptor),
  // authorized by the joiner/owner cap; a PRIVATE room opens the space keyring encryptor.
  let client: StarfishClient;
  let enc: Encryptor | null;
  let pullPath: string;
  if (isPublicSpaceId(spaceId)) {
    const auth = publicSpaceAuth(session, spaceId);
    client = makeClient(auth.cap, auth.signingKey);
    enc = null;
    pullPath = pubstreamRoomPull(auth.ownerId, spaceId, roomId);
  } else {
    const space = await buildSpaceEncryptor(session, spaceId);
    if (!space) return null;
    client = space.client;
    enc = space.enc;
    pullPath = streamRoomPull(roomId);
  }

  try {
    const { data } = await pullAndFold(client, enc, pullPath, { appendField: 'items', last: PREVIEW_TAIL });
    return latestSenderLine(data.messages, data.edits, session.userId);
  } catch {
    return null; // no keyring yet / unreachable / nothing previewable → generic banner
  }
}
