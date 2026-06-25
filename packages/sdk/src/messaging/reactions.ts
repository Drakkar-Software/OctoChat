import { randomId } from '../domain/ids';
import type { MessageEditEvent, PinEvent, Reaction, ReactionEvent } from '../domain/types';

/** Wider emoji set for the composer's insert palette — shown in a single
 *  horizontal scroller (never wraps to a second line). */
export const COMPOSER_EMOJIS = [
  '👍', '👎', '👏', '🙏', '🙌', '🤝', '💪', '🫶',
  '😀', '😄', '😂', '🤣', '😊', '😍', '😘', '😉',
  '😎', '🤔', '😴', '😅', '😭', '😡', '🥳', '🤯',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💯',
  '🔥', '✨', '⭐', '🌊', '⚓', '🚀', '🎉', '🎊',
  '✅', '❌', '⚠️', '💡', '👀', '👋', '🐙', '🦑',
] as const;

/** Fold append-only reaction events into per-emoji counts for one message. */
export function aggregateReactions(events: ReactionEvent[], msgId: string, me: string): Reaction[] {
  const byEmoji = new Map<string, Set<string>>();
  const ordered = events.filter((e) => e.msgId === msgId).sort((a, b) => a.ts - b.ts);
  for (const e of ordered) {
    if (!byEmoji.has(e.emoji)) byEmoji.set(e.emoji, new Set());
    const users = byEmoji.get(e.emoji)!;
    if (e.kind === 'add') users.add(e.userId);
    else users.delete(e.userId);
  }
  const out: Reaction[] = [];
  for (const [emoji, users] of byEmoji) {
    if (users.size > 0) out.push({ emoji, count: users.size, mine: users.has(me), userIds: [...users] });
  }
  return out;
}

/** Number of replies anchored to a parent message. */
export function replyCount(messages: { parentId?: string }[], msgId: string): number {
  return messages.filter((m) => m.parentId === msgId).length;
}

/** Fold ALL reaction events for ALL messages in a single O(N) pass, returning a map
 *  from message-id to the aggregated Reaction[] for that message (same shape as what
 *  `aggregateReactions` returns per message). Empty arrays are omitted from the map.
 *
 *  Use this in list contexts (RoomConversation, ThreadConversation) instead of calling
 *  `aggregateReactions` per row — that incurs O(N·events) per list pass and re-fires
 *  for every visible row when any reaction changes. This builds the map once per events
 *  change (in `useMemo`) and each row reads its slice in O(1) via `map.get(msgId)`.
 *
 *  Mirrors the `replyCounts` pattern already used for thread counts. */
export function aggregateAllReactions(
  events: ReactionEvent[],
  me: string,
): Map<string, Reaction[]> {
  // Two-level accumulator: msgId → emoji → Set<userId>. A single O(N) scan over all
  // events; each step runs in O(1) (Map/Set operations are amortised constant).
  const byMsgEmoji = new Map<string, Map<string, Set<string>>>();
  // Process in timestamp order so later add/remove events win over earlier ones.
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  for (const e of sorted) {
    let byEmoji = byMsgEmoji.get(e.msgId);
    if (!byEmoji) { byEmoji = new Map(); byMsgEmoji.set(e.msgId, byEmoji); }
    let users = byEmoji.get(e.emoji);
    if (!users) { users = new Set(); byEmoji.set(e.emoji, users); }
    if (e.kind === 'add') users.add(e.userId);
    else users.delete(e.userId);
  }
  const out = new Map<string, Reaction[]>();
  for (const [msgId, byEmoji] of byMsgEmoji) {
    const reactions: Reaction[] = [];
    for (const [emoji, users] of byEmoji) {
      if (users.size > 0) reactions.push({ emoji, count: users.size, mine: users.has(me), userIds: [...users] });
    }
    if (reactions.length > 0) out.set(msgId, reactions);
  }
  return out;
}

/** Reply count per parent id in a single O(n) pass. Used to bust the message-list
 *  row memo when a reply arrives (the parent row reads its count from this map), and
 *  to avoid an O(n²) `replyCount` call per rendered row. */
export function replyCounts(messages: { parentId?: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of messages) {
    if (m.parentId) out.set(m.parentId, (out.get(m.parentId) ?? 0) + 1);
  }
  return out;
}

// ── Append-only event builders ───────────────────────────────────────────────
// Shared by both room hooks (merge-doc `useRoom` writes them into the doc; append-log
// `useRoom` wraps them in an envelope). Pure + id/ts-injected so the net-toggle
// logic — the bit most prone to drift between the two paths — lives in ONE place and is
// unit-testable. Each hook keeps its own WRITE; only the event shape is shared.

/** The toggle a tap implies: if the user currently has a net-add for this (msg, emoji),
 *  the tap REMOVES it, else it ADDS. `current` is the live reaction-event list; `now`
 *  and the random id are injected by the caller (the store mutator / append). */
export function reactionToggleEvent(
  current: ReactionEvent[],
  msgId: string,
  emoji: string,
  userId: string,
  now: number,
): ReactionEvent {
  const net = current
    .filter((e) => e.msgId === msgId && e.emoji === emoji && e.userId === userId)
    .reduce((n, e) => n + (e.kind === 'add' ? 1 : -1), 0);
  return { id: randomId(), msgId, emoji, userId, kind: net > 0 ? 'remove' : 'add', ts: now };
}

/** An edit event (folded at render by `resolveEdit`; the author check there is the guard). */
export function messageEditEvent(msgId: string, userId: string, text: string, now: number): MessageEditEvent {
  return { id: randomId(), msgId, userId, kind: 'edit', text, ts: now };
}

/** A delete (tombstone) event — same `edits` log as {@link messageEditEvent}, kind 'delete'. */
export function messageDeleteEvent(msgId: string, userId: string, now: number): MessageEditEvent {
  return { id: randomId(), msgId, userId, kind: 'delete', ts: now };
}

/** A pin/unpin event (folded by `resolvePinned` with the space owner as the guard). */
export function pinToggleEvent(msgId: string, userId: string, kind: 'pin' | 'unpin', now: number): PinEvent {
  return { id: randomId(), msgId, userId, kind, ts: now };
}
