/**
 * Build a decrypted one-line preview ("Name: message") for a notification, by
 * pulling and decrypting a room's latest message on demand. Driven by the
 * `preview` notification setting and used only where the app renders the toast
 * itself (web/desktop — see `notify.ts`); native banners are OS-rendered from the
 * generic FCM payload and can't be rewritten.
 *
 * Scoped to PRIVATE (E2EE) rooms — the whole point is local decryption. Public
 * (plaintext) rooms return null and fall back to the generic body. BOTH private
 * room kinds are handled: a regular room is a single merge-doc (`{messages,edits}`)
 * at the chat path; a STREAM room is an append-only log of sealed `{t,e}` envelopes
 * at a separate path, which we fold the same way `use-stream-room` does. Any failure
 * (no keyring yet, server unreachable, no text message) returns null so the caller
 * shows the generic "New message" banner instead.
 */
import { buildSpaceEncryptor } from './cross-room';
import { resolveEdit, type StoredMsg } from './message-view';
import { readPseudo } from './starfish/client';
import type { Session } from './starfish/identity';
import { roomPull, spaceIdFromRoomId, streamRoomPull } from './starfish/paths';
import { isPublicSpaceId } from './starfish/pubspace';
import type { MessageEditEvent } from './types';

/** Hard cap on preview length so a long message can't overflow the OS toast. */
const PREVIEW_MAX_CHARS = 140;

function clip(text: string): string {
  const t = text.trim();
  return t.length > PREVIEW_MAX_CHARS ? `${t.slice(0, PREVIEW_MAX_CHARS - 1)}…` : t;
}

/** A stream room's append-log element, as decrypted — the same typed envelope
 *  `use-stream-room` reads. Only `msg`/`edit` carry text a preview needs. */
type StreamEnvelope =
  | { t: 'msg'; e: StoredMsg }
  | { t: 'edit'; e: MessageEditEvent }
  | { t: 'reaction'; e: unknown };

/**
 * Pick the newest previewable message from a folded log and format it as
 * "Name: text", or null when there's nothing to show (all own / deleted / textless).
 * Shared by both room kinds so the merge-doc and stream-log paths preview identically.
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
  if (isPublicSpaceId(spaceId)) return null;

  const space = await buildSpaceEncryptor(session, spaceId);
  if (!space) return null;
  const { client, enc } = space;

  // A regular room is a single merge-doc at the chat path. When it's there, preview it.
  const res = await client.pull(roomPull(roomId)).catch(() => null);
  const data = res?.data as Record<string, unknown> | undefined;
  if (data?._encrypted) {
    const plain = (await enc.decrypt(data)) as { messages?: StoredMsg[]; edits?: MessageEditEvent[] };
    return latestSenderLine(plain.messages ?? [], plain.edits ?? [], session.userId);
  }

  // No merge-doc → a STREAM room: its messages are an append-only log at a separate
  // path, each element a sealed `{t,e}` envelope. Fold it like `use-stream-room` does
  // (the server `ts` is authoritative), then preview the latest line identically.
  let items: { ts: number; data: Record<string, unknown> }[];
  try {
    items = (await client.pull<{ ts: number; data: Record<string, unknown> }>(streamRoomPull(roomId), {
      appendField: 'items',
    })) as { ts: number; data: Record<string, unknown> }[];
  } catch {
    return null;
  }
  const messages: StoredMsg[] = [];
  const edits: MessageEditEvent[] = [];
  for (const item of items ?? []) {
    try {
      const env = (await enc.decrypt(item.data)) as StreamEnvelope;
      if (env?.t === 'msg') messages.push({ ...env.e, ts: env.e.ts || item.ts });
      else if (env?.t === 'edit') edits.push({ ...env.e, ts: env.e.ts || item.ts });
    } catch {
      /* a single undecryptable element must not blank the whole preview */
    }
  }
  return latestSenderLine(messages, edits, session.userId);
}
