import { describe, expect, it, vi } from 'vitest';


import { buildThreadDigest } from './threads';
import type { StoredMsg } from '../format/message-view';
import type { MessageEditEvent } from '@drakkar.software/octochat-sdk';

// Compact message factory — `id`/`ts` are the only fields most cases vary.
const msg = (id: string, ts: number, over: Partial<StoredMsg> = {}): StoredMsg => ({
  id,
  authorId: 'u1',
  ts,
  ...over,
});

describe('buildThreadDigest', () => {
  it('summarises only top-level messages that have replies', () => {
    const messages = [
      msg('p1', 100, { text: 'Has replies' }),
      msg('p2', 110, { text: 'Lonely top-level' }), // no replies → not a thread
      msg('r1', 120, { parentId: 'p1' }),
    ];
    const digest = buildThreadDigest(messages, [], 0);
    expect(digest).toHaveLength(1);
    expect(digest[0]).toMatchObject({ parentId: 'p1', replyCount: 1 });
  });

  it('sorts by most recent activity and caps at the limit', () => {
    const messages = [
      msg('p1', 100, { text: 'old' }),
      msg('r1', 105, { parentId: 'p1' }),
      msg('p2', 200, { text: 'mid' }),
      msg('r2', 900, { parentId: 'p2' }), // newest reply → p2 ranks first
      msg('p3', 300, { text: 'new parent' }),
      msg('r3', 310, { parentId: 'p3' }),
    ];
    const order = buildThreadDigest(messages, [], 0, undefined, 2).map((t) => t.parentId);
    expect(order).toEqual(['p2', 'p3']);
  });

  it('counts only replies newer than the read mark as unread', () => {
    const messages = [
      msg('p1', 100, { text: 'parent' }),
      msg('r1', 150, { parentId: 'p1' }), // <= readBefore → read
      msg('r2', 250, { parentId: 'p1' }), // > readBefore → unread
      msg('r3', 300, { parentId: 'p1' }), // > readBefore → unread
    ];
    const [thread] = buildThreadDigest(messages, [], 200);
    expect(thread.replyCount).toBe(3);
    expect(thread.unread).toBe(2);
  });

  it('excludes the viewer\'s own replies from unread (like notifications)', () => {
    const messages = [
      msg('p1', 100, { text: 'parent' }),
      msg('r1', 250, { parentId: 'p1', authorId: 'me' }), // mine → never unread to me
      msg('r2', 260, { parentId: 'p1', authorId: 'u2' }), // someone else → unread
      msg('r3', 270, { parentId: 'p1', authorId: 'me' }), // mine → never unread to me
    ];
    const [thread] = buildThreadDigest(messages, [], 200, 'me');
    expect(thread.replyCount).toBe(3); // all replies still count toward the thread
    expect(thread.unread).toBe(1); // only u2's reply badges as unread
  });

  it('skips replies whose parent is not in the loaded log', () => {
    const messages = [msg('r1', 120, { parentId: 'missing' })];
    expect(buildThreadDigest(messages, [], 0)).toHaveLength(0);
  });

  it('labels from text, attachment name, then a generic fallback', () => {
    const messages = [
      msg('p1', 100, { text: '  hi there  ' }),
      msg('r1', 110, { parentId: 'p1' }),
      msg('p2', 120, { attachment: { blobId: 'b', name: 'shot.png', mime: 'image/png', size: 1, kind: 'image' } }),
      msg('r2', 130, { parentId: 'p2' }),
      msg('p3', 140, {}), // no text, no attachment
      msg('r3', 150, { parentId: 'p3' }),
    ];
    const labels = Object.fromEntries(buildThreadDigest(messages, [], 0).map((t) => [t.parentId, t.label]));
    expect(labels.p1).toBe('hi there');
    expect(labels.p2).toBe('shot.png');
    expect(labels.p3).toBe('Thread');
  });

  it('folds the parent edit/delete into the label', () => {
    const messages = [
      msg('p1', 100, { text: 'original' }),
      msg('r1', 110, { parentId: 'p1' }),
      msg('p2', 120, { text: 'doomed' }),
      msg('r2', 130, { parentId: 'p2' }),
    ];
    const edits: MessageEditEvent[] = [
      { id: 'e1', msgId: 'p1', userId: 'u1', kind: 'edit', text: 'edited', ts: 200 },
      { id: 'e2', msgId: 'p2', userId: 'u1', kind: 'delete', ts: 200 },
    ];
    const labels = Object.fromEntries(buildThreadDigest(messages, edits, 0).map((t) => [t.parentId, t.label]));
    expect(labels.p1).toBe('edited');
    expect(labels.p2).toBe('Deleted message');
  });
});
