import { describe, expect, it, vi } from 'vitest';

// `message-view` → `links` value-imports `expo-router` + `react-native` for its
// navigation helpers (unused here). Stub them so the pure helpers run under Node,
// mirroring threads.test.ts.
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' }, Linking: { openURL: vi.fn() } }));

import { dayLabel, mergePendingMessages, resolvePinned, sameDay, type StoredMsg } from './message-view';
import type { OutboxMessage } from './outbox';
import type { PinEvent } from './types';

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
