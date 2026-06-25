import { mentionsUser } from '../messaging/links';
import type { OutboxMessage, OutboxStatus } from '../outbox/outbox-types';
import { aggregateAllReactions, aggregateReactions } from '../messaging/reactions';
import type { AttachmentRef } from '../starfish/attachments';
import type { Message, MessageEditEvent, PinEvent, Reaction, ReactionEvent, User } from '../domain/types';

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

/** Whether two timestamps fall on the same calendar day (local time). Used to
 *  decide where a {@link DateDivider} goes between message groups. */
export function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

// Module-level cached formatters: constructing Intl.DateTimeFormat is expensive
// (locale negotiation + pattern compilation) — reusing them cuts per-row cost in
// long message lists and thread result rows where dayLabel is called for every
// date-divider. Two variants: one with year (cross-year messages) and one without.
const _dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const _dayFmtWithYear = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** Human day label for a message's date divider: "Today" / "Yesterday" / a short
 *  date ("May 23"), dropping to "May 23, 2025" once it predates the current year.
 *  `now` is injectable for tests. */
export function dayLabel(ts: number, now: number = Date.now()): string {
  if (sameDay(ts, now)) return 'Today';
  if (sameDay(ts, now - 86_400_000)) return 'Yesterday';
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return (sameYear ? _dayFmt : _dayFmtWithYear).format(d);
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

/** Whether `msgId` is currently pinned, folded from the append-only `pins` log:
 *  the latest event (by `ts`) authored by the SPACE OWNER wins (`pin` ⇒ true,
 *  `unpin` ⇒ false). Mirrors {@link resolveEdit}'s fold, but the guard is the owner
 *  — only the owner may pin — not the message's author. With no known owner nothing
 *  counts as pinned (so a viewer who can't resolve the owner sees no pins, which is
 *  why owner-id is mandatory at fold time — see the room screen wiring). */
export function resolvePinned(pins: PinEvent[], msgId: string, ownerId?: string): boolean {
  if (!ownerId) return false;
  return (
    pins
      .filter((p) => p.msgId === msgId && p.userId === ownerId)
      .sort((a, b) => a.ts - b.ts)
      .at(-1)?.kind === 'pin'
  );
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
  /** Append-only pin/unpin log for the room — folded per message at render. */
  pins?: PinEvent[];
  /** The space owner's id — the only author whose pin events count. */
  ownerId?: string;
  /** Unsent state when this message is still in the offline outbox (see outbox.ts).
   *  Absent for a server-confirmed message. */
  pending?: OutboxStatus;
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
    pinned: resolvePinned(opts.pins ?? [], m.id, opts.ownerId),
    pending: opts.pending,
  };
}

// ── Batch index builders (O(N) single-pass alternatives to per-row folds) ──────
//
// In list contexts (RoomConversation, ThreadConversation) `toDisplayMessage` is called
// for every visible row, and each call runs `aggregateReactions`, `resolveEdit`, and
// `resolvePinned` — each an O(events) or O(edits) filter+sort scan. With N rows that
// is O(N·(reactions+edits+pins)) per list pass, re-triggered on any reaction or edit.
// The batch builders below mirror the `replyCounts` pattern already used for thread
// counts: build Maps/Sets once per data change (in `useMemo`), then each row reads its
// slice in O(1) via `Map.get / Set.has`.

/** Precomputed index produced by {@link buildMessageIndex}. Passed to
 *  {@link toDisplayMessageIndexed} in place of the raw arrays. */
export interface MessageIndex {
  /** Per-message aggregated reactions (absent key = no reactions). */
  reactions: Map<string, Reaction[]>;
  /** Latest author-authored edit/delete event per message (absent = no edit). */
  edits: Map<string, MessageEditEvent>;
  /** Set of currently-pinned message ids (by latest owner pin event). */
  pinned: Set<string>;
}

/** Fold all edits in a single O(N) pass, keeping the latest event per message
 *  whose `userId === that message's authorId` (the same security guard as in
 *  `resolveEdit`). Returns a Map<msgId, latest-edit>. */
export function resolveEdits(
  edits: MessageEditEvent[],
  messages: { id: string; authorId: string }[],
): Map<string, MessageEditEvent> {
  // Build a msgId→authorId lookup in one pass so the guard check is O(1) per event.
  const authorOf = new Map(messages.map((m) => [m.id, m.authorId]));
  const out = new Map<string, MessageEditEvent>();
  // Scan in time order; later events overwrite earlier ones per message.
  const sorted = [...edits].sort((a, b) => a.ts - b.ts);
  for (const e of sorted) {
    if (e.userId !== authorOf.get(e.msgId)) continue; // security guard: only author's edits count
    out.set(e.msgId, e);
  }
  return out;
}

/** Fold all pin events in a single O(N) pass, returning the set of currently-pinned
 *  message ids. Only the space owner's events count (same guard as `resolvePinned`).
 *  Returns an empty Set when `ownerId` is absent. */
export function resolvePinnedSet(pins: PinEvent[], ownerId?: string): Set<string> {
  if (!ownerId) return new Set();
  // Scan in time order; later events win per message.
  const latest = new Map<string, 'pin' | 'unpin'>();
  const sorted = [...pins].sort((a, b) => a.ts - b.ts);
  for (const p of sorted) {
    if (p.userId !== ownerId) continue; // only the space owner's events count
    latest.set(p.msgId, p.kind);
  }
  const out = new Set<string>();
  for (const [msgId, kind] of latest) {
    if (kind === 'pin') out.add(msgId);
  }
  return out;
}

/** Build a {@link MessageIndex} for an entire message list in one O(N) pass per
 *  array, amortising the per-row fold cost. Designed for `useMemo` in list components:
 *
 *  ```ts
 *  const idx = useMemo(
 *    () => buildMessageIndex(messages, reactions, edits, pins, currentUserId, ownerId),
 *    [messages, reactions, edits, pins, currentUserId, ownerId],
 *  );
 *  ```
 *
 *  Pass `idx` as `extraData` (instead of the raw arrays) so LegendList row memos bust
 *  only when the index itself changes, not on unrelated renders. */
export function buildMessageIndex(
  messages: { id: string; authorId: string }[],
  reactions: ReactionEvent[],
  edits: MessageEditEvent[],
  pins: PinEvent[],
  currentUserId: string,
  ownerId?: string,
): MessageIndex {
  return {
    reactions: aggregateAllReactions(reactions, currentUserId),
    edits: resolveEdits(edits, messages),
    pinned: resolvePinnedSet(pins, ownerId),
  };
}

/** O(1)-per-row alternative to {@link toDisplayMessage}. Reads precomputed slices
 *  from a {@link MessageIndex} instead of scanning the raw arrays per row.
 *  Use in LegendList `renderItem` after building the index once with
 *  {@link buildMessageIndex}. */
export function toDisplayMessageIndexed(
  m: StoredMsg,
  idx: MessageIndex,
  currentUserId: string,
  opts: Omit<DisplayOpts, 'edits' | 'pins' | 'ownerId'> = {},
): Message {
  const edit = idx.edits.get(m.id);
  const deleted = edit?.kind === 'delete';
  const text = deleted ? undefined : edit?.kind === 'edit' ? edit.text : m.text;
  const mention = m.authorId !== currentUserId && mentionsUser(text, opts.selfName);
  return {
    id: m.id,
    roomId: '',
    authorId: m.authorId,
    time: hhmm(m.ts),
    text,
    attachmentRef: m.attachment,
    reactions: idx.reactions.get(m.id) ?? [],
    threadCount: opts.threadCount,
    mention,
    unread: m.ts > (opts.lastReadAt ?? 0),
    edited: edit?.kind === 'edit',
    deleted,
    pinned: idx.pinned.has(m.id),
    pending: opts.pending,
  };
}

/** Fold the offline outbox's pending entries into the store's message list so they
 *  render as bubbles. Drops any pending entry whose id is already in the store (it
 *  has synced — dedup-by-id, the outbox's core invariant) and appends the rest after
 *  the last stored message (queued entries carry `ts = Date.now()`, so they're the
 *  newest and belong at the tail — appending preserves the store's existing order,
 *  keeping continuation grouping + date dividers intact). Returns `stored` unchanged
 *  when nothing pending survives, so an idle render allocates nothing. */
export function mergePendingMessages(stored: StoredMsg[], pending: OutboxMessage[]): StoredMsg[] {
  if (!pending.length) return stored;
  const ids = new Set(stored.map((m) => m.id));
  const extra: StoredMsg[] = pending
    .filter((p) => !ids.has(p.id))
    .map((p) => ({ id: p.id, authorId: p.authorId, text: p.text, ts: p.ts, parentId: p.parentId }));
  return extra.length ? [...stored, ...extra] : stored;
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
