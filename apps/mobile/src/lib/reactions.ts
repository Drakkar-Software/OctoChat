import { randomId } from './ids';
import type { MessageEditEvent, PinEvent, Reaction, ReactionEvent } from './types';

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
// `useStreamRoom` wraps them in an envelope). Pure + id/ts-injected so the net-toggle
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
