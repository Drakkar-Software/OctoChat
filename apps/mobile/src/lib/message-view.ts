import { mentionsUser } from './links';
import { aggregateReactions } from './reactions';
import type { AttachmentRef } from './starfish/attachments';
import type { Message, MessageEditEvent, ReactionEvent, User } from './types';

/** Shape of a message as stored (encrypted) in a room document. */
export interface StoredMsg {
  id: string;
  authorId: string;
  text?: string;
  ts: number;
  parentId?: string;
  attachment?: AttachmentRef;
}

/** Two messages from the same author posted within this window collapse into
 *  one group: the later one renders without a repeated avatar/name header. */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Whether `m` continues `prev` — same author, posted within
 *  {@link GROUP_WINDOW_MS} — so its avatar and name header can be suppressed. */
export function isContinuation(m: StoredMsg, prev?: StoredMsg): boolean {
  if (!prev) return false;
  const gap = m.ts - prev.ts;
  return prev.authorId === m.authorId && gap >= 0 && gap < GROUP_WINDOW_MS;
}

/** A user's display label: "You" for the viewer, else the resolved pseudo, else
 *  the hex id prefix until a pseudo arrives. Used for authors and reactors. */
export function displayName(userId: string, currentUserId: string, pseudo?: string): string {
  if (userId === currentUserId) return 'You';
  return pseudo?.trim() || userId.slice(0, 8);
}

export function authorFor(authorId: string, currentUserId: string, pseudo?: string, avatar?: string): User {
  // Prefer the profile pseudo; fall back to the hex prefix until one resolves.
  // `initials` follows the resolved name for everyone (incl. me) so the monogram
  // stays consistent when no avatar is set.
  const named = pseudo?.trim();
  const display = named || authorId.slice(0, 8);
  return {
    id: authorId,
    name: displayName(authorId, currentUserId, pseudo),
    handle: named ? `@${named}` : `@${authorId.slice(0, 6)}`,
    initials: display.slice(0, 2).toUpperCase(),
    avatar,
  };
}

export function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Latest edit/delete event for a message, folded from the append-only `edits`
 *  log (matches the reactions house style: filter → sort by `ts` asc → take last).
 *  SECURITY: only events authored by the message's own author count — the room doc
 *  is E2EE with no server-side authorship check, so a peer could push an edit for
 *  someone else's message; this filter, not the UI, is the real guard. */
export function resolveEdit(
  edits: MessageEditEvent[],
  msgId: string,
  authorId: string,
): MessageEditEvent | undefined {
  return edits
    .filter((e) => e.msgId === msgId && e.userId === authorId)
    .sort((a, b) => a.ts - b.ts)
    .at(-1);
}

/** View-time context for mapping a stored message to its display form. */
export interface DisplayOpts {
  /** Reply count if this message anchors a thread. */
  threadCount?: number;
  /** The viewer's pseudo — flags a message that `@`-mentions them. */
  selfName?: string;
  /** The viewer's last-read timestamp for this room — messages newer than it are
   *  "unread" (escalates a mention's highlight). Absent ⇒ treat as never read. */
  lastReadAt?: number;
  /** Append-only edit/delete log for the room — folded per message at render. */
  edits?: MessageEditEvent[];
}

/** Map a stored message → the display `Message` the UI components expect. */
export function toDisplayMessage(
  m: StoredMsg,
  reactions: ReactionEvent[],
  currentUserId: string,
  opts: DisplayOpts = {},
): Message {
  // Fold the author's latest edit/delete over the stored body.
  const edit = resolveEdit(opts.edits ?? [], m.id, m.authorId);
  const deleted = edit?.kind === 'delete';
  const text = deleted ? undefined : edit?.kind === 'edit' ? edit.text : m.text;
  // Don't flag your own message as mentioning you, even if you typed your name.
  const mention = m.authorId !== currentUserId && mentionsUser(text, opts.selfName);
  return {
    id: m.id,
    roomId: '',
    authorId: m.authorId,
    time: hhmm(m.ts),
    text,
    attachmentRef: m.attachment,
    reactions: aggregateReactions(reactions, m.id, currentUserId),
    threadCount: opts.threadCount,
    mention,
    unread: m.ts > (opts.lastReadAt ?? 0),
    edited: edit?.kind === 'edit',
    deleted,
  };
}

/** The current user's most recent top-level message that is still editable —
 *  it has text and hasn't been deleted (edits folded via {@link resolveEdit}).
 *  Returns null when they have no such message. Powers the composer's ArrowUp
 *  "edit my last message" shortcut. */
export function lastEditableMessageId(
  messages: StoredMsg[],
  edits: MessageEditEvent[],
  currentUserId: string,
): string | null {
  const mine = messages.filter((m) => m.authorId === currentUserId && !m.parentId).sort((a, b) => b.ts - a.ts);
  for (const m of mine) {
    const edit = resolveEdit(edits, m.id, m.authorId);
    if (edit?.kind === 'delete') continue;
    const text = edit?.kind === 'edit' ? edit.text : m.text;
    if (text && text.trim()) return m.id;
  }
  return null;
}
