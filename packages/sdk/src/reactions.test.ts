import { describe, expect, it } from 'vitest';

import {
  aggregateReactions,
  messageDeleteEvent,
  messageEditEvent,
  pinToggleEvent,
  reactionToggleEvent,
  replyCount,
  replyCounts,
} from './reactions';
import type { ReactionEvent } from '@drakkar.software/octochat-sdk';

const r = (over: Partial<ReactionEvent>): ReactionEvent => ({
  id: 'x', msgId: 'm1', emoji: '👍', userId: 'u1', kind: 'add', ts: 0, ...over,
});

describe('reactionToggleEvent', () => {
  it('adds when the user has no live reaction for (msg, emoji)', () => {
    expect(reactionToggleEvent([], 'm1', '👍', 'u1', 100).kind).toBe('add');
  });

  it('removes when the user currently has a net-add', () => {
    const cur = [r({ kind: 'add' })];
    expect(reactionToggleEvent(cur, 'm1', '👍', 'u1', 100).kind).toBe('remove');
  });

  it('adds again once a prior add was removed (net 0)', () => {
    const cur = [r({ ts: 1, kind: 'add' }), r({ ts: 2, kind: 'remove' })];
    expect(reactionToggleEvent(cur, 'm1', '👍', 'u1', 100).kind).toBe('add');
  });

  it('ignores other users, emojis, and messages when computing net', () => {
    const cur = [
      r({ userId: 'u2', kind: 'add' }), // other user
      r({ emoji: '🔥', kind: 'add' }), // other emoji
      r({ msgId: 'm2', kind: 'add' }), // other message
    ];
    expect(reactionToggleEvent(cur, 'm1', '👍', 'u1', 100).kind).toBe('add');
  });

  it('stamps the supplied ts and the requested identity', () => {
    const e = reactionToggleEvent([], 'm9', '🎉', 'me', 4242);
    expect(e).toMatchObject({ msgId: 'm9', emoji: '🎉', userId: 'me', kind: 'add', ts: 4242 });
    expect(typeof e.id).toBe('string');
    expect(e.id.length).toBeGreaterThan(0);
  });
});

describe('aggregateReactions', () => {
  it('folds add/remove into per-emoji counts with a `mine` flag', () => {
    const events: ReactionEvent[] = [
      r({ ts: 1, userId: 'u1', kind: 'add' }),
      r({ ts: 2, userId: 'u2', kind: 'add' }),
      r({ ts: 3, userId: 'u2', kind: 'remove' }),
      r({ ts: 4, emoji: '🔥', userId: 'me', kind: 'add' }),
    ];
    const out = aggregateReactions(events, 'm1', 'me');
    expect(out).toEqual([
      { emoji: '👍', count: 1, mine: false, userIds: ['u1'] },
      { emoji: '🔥', count: 1, mine: true, userIds: ['me'] },
    ]);
  });

  it('drops an emoji once every reactor has removed it', () => {
    const events: ReactionEvent[] = [r({ ts: 1, kind: 'add' }), r({ ts: 2, kind: 'remove' })];
    expect(aggregateReactions(events, 'm1', 'me')).toEqual([]);
  });
});

describe('replyCounts / replyCount', () => {
  const msgs = [
    { parentId: undefined },
    { parentId: 'a' },
    { parentId: 'a' },
    { parentId: 'b' },
  ];

  it('counts replies per parent in one pass', () => {
    const m = replyCounts(msgs);
    expect(m.get('a')).toBe(2);
    expect(m.get('b')).toBe(1);
    expect(m.has('undefined')).toBe(false);
  });

  it('replyCount matches replyCounts for a given id', () => {
    expect(replyCount(msgs.map((m, i) => ({ ...m, id: String(i) })), 'a')).toBe(2);
  });
});

describe('edit / delete / pin builders', () => {
  it('messageEditEvent carries the new text + kind edit', () => {
    expect(messageEditEvent('m1', 'u1', 'hi', 5)).toMatchObject({ msgId: 'm1', userId: 'u1', kind: 'edit', text: 'hi', ts: 5 });
  });

  it('messageDeleteEvent is a tombstone with no text', () => {
    const e = messageDeleteEvent('m1', 'u1', 5);
    expect(e).toMatchObject({ msgId: 'm1', userId: 'u1', kind: 'delete', ts: 5 });
    expect(e.text).toBeUndefined();
  });

  it('pinToggleEvent carries the requested kind', () => {
    expect(pinToggleEvent('m1', 'owner', 'pin', 5).kind).toBe('pin');
    expect(pinToggleEvent('m1', 'owner', 'unpin', 5).kind).toBe('unpin');
  });
});
