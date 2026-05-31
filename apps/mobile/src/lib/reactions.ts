import type { Reaction, ReactionEvent } from './types';

/** Emoji offered in the quick-reaction palette when adding a reaction. */
export const QUICK_REACTIONS = ['👍', '😀', '😂', '❤️', '🎉', '🐙'] as const;

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
