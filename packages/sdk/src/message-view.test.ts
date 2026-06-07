import { describe, expect, it, vi } from 'vitest';


import {
  GROUP_WINDOW_MS,
  dayLabel,
  isContinuation,
  lastEditableMessageId,
  mergePendingMessages,
  resolveEdit,
  resolvePinned,
  sameDay,
  toDisplayMessage,
  type StoredMsg,
} from './message-view';
import type { OutboxMessage } from './outbox';
import type { MessageEditEvent, PinEvent, ReactionEvent } from '@drakkar.software/octochat-sdk';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();

const pin = (msgId: string, userId: string, kind: 'pin' | 'unpin', ts: number): PinEvent => ({
  id: `${msgId}-${ts}`,
  msgId,
  userId,
  kind,
  ts,
});

describe('sameDay', () => {
  const now = at(2026, 4, 23);

  it('is true within one calendar day regardless of time', () => {
    expect(sameDay(at(2026, 4, 23, 0), at(2026, 4, 23, 23))).toBe(true);
  });

  it('is false across a midnight boundary even when hours are close', () => {
    expect(sameDay(at(2026, 4, 22, 23), at(2026, 4, 23, 1))).toBe(false);
  });

  it('distinguishes the same day-of-month in different months/years', () => {
    expect(sameDay(at(2026, 3, 23), now)).toBe(false);
    expect(sameDay(at(2025, 4, 23), now)).toBe(false);
  });
});

describe('dayLabel', () => {
  const now = at(2026, 4, 23);

  it('labels the current day "Today"', () => {
    expect(dayLabel(at(2026, 4, 23, 9), now)).toBe('Today');
  });

  it('labels the prior day "Yesterday"', () => {
    expect(dayLabel(at(2026, 4, 22), now)).toBe('Yesterday');
  });

  it('omits the year for an older date in the current year', () => {
    const label = dayLabel(at(2026, 0, 5), now);
    expect(label).not.toBe('Today');
    expect(label).not.toBe('Yesterday');
    expect(label).not.toContain('2026');
  });

  it('includes the year once the date predates the current year', () => {
    expect(dayLabel(at(2025, 11, 30), now)).toContain('2025');
  });
});

describe('resolvePinned', () => {
  const owner = 'owner-1';

  it('is false with no events', () => {
    expect(resolvePinned([], 'm1', owner)).toBe(false);
  });

  it('is true after the owner pins', () => {
    expect(resolvePinned([pin('m1', owner, 'pin', 10)], 'm1', owner)).toBe(true);
  });

  it('takes the latest owner event by ts — a later unpin overrides an earlier pin', () => {
    const pins = [pin('m1', owner, 'pin', 10), pin('m1', owner, 'unpin', 20)];
    expect(resolvePinned(pins, 'm1', owner)).toBe(false);
    // ...and a re-pin after that wins again, regardless of array order.
    const repinned = [...pins, pin('m1', owner, 'pin', 30)].reverse();
    expect(resolvePinned(repinned, 'm1', owner)).toBe(true);
  });

  it('ignores pin events authored by anyone but the owner (the real guard)', () => {
    expect(resolvePinned([pin('m1', 'peer-2', 'pin', 10)], 'm1', owner)).toBe(false);
    // A forged peer unpin can't clear a genuine owner pin either.
    const pins = [pin('m1', owner, 'pin', 10), pin('m1', 'peer-2', 'unpin', 20)];
    expect(resolvePinned(pins, 'm1', owner)).toBe(true);
  });

  it('is false when the owner is unknown — nothing can count as pinned', () => {
    expect(resolvePinned([pin('m1', owner, 'pin', 10)], 'm1', undefined)).toBe(false);
  });

  it('scopes to the requested message id', () => {
    expect(resolvePinned([pin('m2', owner, 'pin', 10)], 'm1', owner)).toBe(false);
  });
});

describe('mergePendingMessages', () => {
  const stored: StoredMsg[] = [{ id: 's1', authorId: 'u1', text: 'hi', ts: 10 }];
  const out = (id: string, over: Partial<OutboxMessage> = {}): OutboxMessage => ({
    id,
    roomId: 'sp-1-general',
    spaceId: 'sp-1',
    kind: 'channel',
    authorId: 'u1',
    text: 'queued',
    ts: 20,
    status: 'queued',
    attempts: 0,
    ...over,
  });

  it('returns the stored array unchanged when nothing is pending', () => {
    expect(mergePendingMessages(stored, [])).toBe(stored);
  });

  it('appends a pending entry as a StoredMsg after the stored messages', () => {
    const merged = mergePendingMessages(stored, [out('p1')]);
    expect(merged.map((m) => m.id)).toEqual(['s1', 'p1']);
    expect(merged[1]).toMatchObject({ id: 'p1', authorId: 'u1', text: 'queued', ts: 20 });
  });

  it('drops a pending entry whose id already synced into the store (dedup-by-id)', () => {
    const merged = mergePendingMessages([{ id: 'p1', authorId: 'u1', text: 'synced', ts: 5 }], [out('p1')]);
    expect(merged.map((m) => m.id)).toEqual(['p1']);
    expect(merged[0].text).toBe('synced'); // the confirmed copy wins
  });
});

const m = (over: Partial<StoredMsg>): StoredMsg => ({ id: 'm1', authorId: 'u1', ts: 1000, ...over });

describe('isContinuation', () => {
  it('is false with no previous message', () => {
    expect(isContinuation(m({}))).toBe(false);
  });

  it('groups the same author within the window', () => {
    expect(isContinuation(m({ ts: 1000 + GROUP_WINDOW_MS - 1 }), m({ ts: 1000 }))).toBe(true);
  });

  it('breaks the group at/after the window', () => {
    expect(isContinuation(m({ ts: 1000 + GROUP_WINDOW_MS }), m({ ts: 1000 }))).toBe(false);
  });

  it('breaks the group on a different author (bot vs human)', () => {
    expect(isContinuation(m({ authorId: 'bot-r1' }), m({ authorId: 'u1' }))).toBe(false);
  });

  it('breaks on an out-of-order (negative-gap) timestamp', () => {
    expect(isContinuation(m({ ts: 900 }), m({ ts: 1000 }))).toBe(false);
  });
});

describe('resolveEdit (author-guarded fold)', () => {
  const edits: MessageEditEvent[] = [
    { id: 'e1', msgId: 'm1', userId: 'u1', kind: 'edit', text: 'first', ts: 1 },
    { id: 'e2', msgId: 'm1', userId: 'u1', kind: 'edit', text: 'latest', ts: 3 },
    { id: 'e3', msgId: 'm1', userId: 'attacker', kind: 'delete', ts: 99 }, // not the author
  ];

  it('takes the latest event authored by the message author', () => {
    expect(resolveEdit(edits, 'm1', 'u1')?.text).toBe('latest');
  });

  it('ignores events not authored by the message author — a forged later delete cannot win', () => {
    expect(resolveEdit(edits, 'm1', 'u1')?.kind).toBe('edit');
  });
});

describe('toDisplayMessage', () => {
  const noReactions: ReactionEvent[] = [];

  it('folds an edit over the stored body and flags `edited`', () => {
    const edits: MessageEditEvent[] = [{ id: 'e1', msgId: 'm1', userId: 'u1', kind: 'edit', text: 'new', ts: 5 }];
    const d = toDisplayMessage(m({ text: 'old' }), noReactions, 'me', { edits });
    expect(d.text).toBe('new');
    expect(d.edited).toBe(true);
    expect(d.deleted).toBe(false);
  });

  it('hides the body and marks `deleted` on a tombstone', () => {
    const edits: MessageEditEvent[] = [{ id: 'e1', msgId: 'm1', userId: 'u1', kind: 'delete', ts: 5 }];
    const d = toDisplayMessage(m({ text: 'secret' }), noReactions, 'me', { edits });
    expect(d.deleted).toBe(true);
    expect(d.text).toBeUndefined();
  });

  it('marks unread relative to lastReadAt', () => {
    expect(toDisplayMessage(m({ ts: 100 }), noReactions, 'me', { lastReadAt: 50 }).unread).toBe(true);
    expect(toDisplayMessage(m({ ts: 100 }), noReactions, 'me', { lastReadAt: 150 }).unread).toBe(false);
  });

  it('carries the thread reply count through to the display message', () => {
    expect(toDisplayMessage(m({}), noReactions, 'me', { threadCount: 3 }).threadCount).toBe(3);
  });
});

describe('lastEditableMessageId', () => {
  it('returns the viewer’s most recent non-deleted text message', () => {
    const msgs: StoredMsg[] = [
      m({ id: 'a', authorId: 'me', text: 'first', ts: 1 }),
      m({ id: 'b', authorId: 'me', text: 'second', ts: 2 }),
      m({ id: 'c', authorId: 'other', text: 'theirs', ts: 3 }),
    ];
    expect(lastEditableMessageId(msgs, [], 'me')).toBe('b');
  });

  it('skips a message the viewer has since deleted', () => {
    const msgs: StoredMsg[] = [
      m({ id: 'a', authorId: 'me', text: 'keep', ts: 1 }),
      m({ id: 'b', authorId: 'me', text: 'gone', ts: 2 }),
    ];
    const edits: MessageEditEvent[] = [{ id: 'e', msgId: 'b', userId: 'me', kind: 'delete', ts: 3 }];
    expect(lastEditableMessageId(msgs, edits, 'me')).toBe('a');
  });

  it('ignores replies (parentId set)', () => {
    const msgs: StoredMsg[] = [
      m({ id: 'a', authorId: 'me', text: 'root', ts: 1 }),
      m({ id: 'b', authorId: 'me', text: 'reply', ts: 2, parentId: 'a' }),
    ];
    expect(lastEditableMessageId(msgs, [], 'me')).toBe('a');
  });
});
