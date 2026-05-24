/**
 * Build a decrypted one-line preview ("Name: message") for a notification, by
 * pulling and decrypting a room's latest message on demand. Driven by the
 * `preview` notification setting and used only where the app renders the toast
 * itself (web/desktop — see `notify.ts`); native banners are OS-rendered from the
 * generic FCM payload and can't be rewritten.
 *
 * Scoped to PRIVATE (E2EE) rooms — the whole point is local decryption. Public
 * (plaintext) rooms return null and fall back to the generic body. Any failure
 * (no keyring yet, server unreachable, no text message) returns null so the
 * caller shows the generic "New message" banner instead.
 */
import { buildSpaceEncryptor } from './cross-room';
import { resolveEdit, type StoredMsg } from './message-view';
import { readPseudo } from './starfish/client';
import type { Session } from './starfish/identity';
import { roomPull, spaceIdFromRoomId } from './starfish/paths';
import { isPublicSpaceId } from './starfish/pubspace';
import type { MessageEditEvent } from './types';

/** Hard cap on preview length so a long message can't overflow the OS toast. */
const PREVIEW_MAX_CHARS = 140;

function clip(text: string): string {
  const t = text.trim();
  return t.length > PREVIEW_MAX_CHARS ? `${t.slice(0, PREVIEW_MAX_CHARS - 1)}…` : t;
}

export async function loadLatestMessagePreview(session: Session, roomId: string): Promise<string | null> {
  const spaceId = spaceIdFromRoomId(roomId);
  if (isPublicSpaceId(spaceId)) return null;

  const space = await buildSpaceEncryptor(session, spaceId);
  if (!space) return null;
  const { client, enc } = space;

  const res = await client.pull(roomPull(roomId)).catch(() => null);
  const data = res?.data as Record<string, unknown> | undefined;
  if (!data || !data._encrypted) return null;

  const plain = (await enc.decrypt(data)) as { messages?: StoredMsg[]; edits?: MessageEditEvent[] };
  const messages = plain.messages ?? [];
  const edits = plain.edits ?? [];

  // Newest first; fold each message's edit/delete log and take the first that still
  // has text (an attachment-only or deleted latest message falls through to generic).
  for (const m of [...messages].sort((a, b) => b.ts - a.ts)) {
    // Skip our own messages: a send from another device fires this room's SSE event
    // here, and "You: …" is a confusing thing to be notified about.
    if (m.authorId === session.userId) continue;
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
