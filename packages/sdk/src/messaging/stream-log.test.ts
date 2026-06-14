import { beforeEach, describe, expect, it } from 'vitest';

import { concatDedupById, fanOut, loadStreamLog, streamLogKey, type StreamEnvelope } from './stream-log';
import { configureKv } from '../config/adapters';

describe('concatDedupById', () => {
  it('appends the new tail after existing, preserving order', () => {
    const out = concatDedupById([{ id: 'a' }, { id: 'b' }], [{ id: 'c' }, { id: 'd' }]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('drops elements whose id is already present', () => {
    const out = concatDedupById([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns the SAME existing reference when nothing new is added (no re-render churn)', () => {
    const existing = [{ id: 'a' }, { id: 'b' }];
    expect(concatDedupById(existing, [])).toBe(existing);
    expect(concatDedupById(existing, [{ id: 'a' }, { id: 'b' }])).toBe(existing);
  });
});

describe('fanOut', () => {
  const elem = (ts: number, data: StreamEnvelope) => ({ data, ts } as unknown as Parameters<typeof fanOut>[0][number]);

  it('routes each envelope to its typed array by discriminant', () => {
    const out = fanOut([
      elem(10, { t: 'msg', e: { id: 'm1', authorId: 'u1', ts: 10, text: 'hi' } }),
      elem(11, { t: 'reaction', e: { id: 'r1', msgId: 'm1', emoji: '👍', userId: 'u1', op: 'add', ts: 11 } as never }),
      elem(12, { t: 'edit', e: { id: 'e1', msgId: 'm1', authorId: 'u1', text: 'edited', ts: 12 } as never }),
      elem(13, { t: 'pin', e: { id: 'p1', msgId: 'm1', userId: 'u1', op: 'pin', ts: 13 } as never }),
    ]);
    expect(out.messages.map((m) => m.id)).toEqual(['m1']);
    expect(out.reactions.map((r) => r.id)).toEqual(['r1']);
    expect(out.edits.map((e) => e.id)).toEqual(['e1']);
    expect(out.pins.map((p) => p.id)).toEqual(['p1']);
  });

  it('stamps the server-assigned element ts onto a payload that lacks its own', () => {
    const out = fanOut([elem(99, { t: 'msg', e: { id: 'm1', authorId: 'u1', ts: 0, text: 'hi' } })]);
    expect(out.messages[0].ts).toBe(99);
  });

  it('skips a null/empty envelope rather than throwing', () => {
    const out = fanOut([elem(1, null as never)]);
    expect(out.messages).toHaveLength(0);
  });
});

// ── streamLogKey user-scoping ─────────────────────────────────────────────────────

describe('streamLogKey user-scoping', () => {
  it('produces distinct keys for different users on the same room', () => {
    expect(streamLogKey('uA', 'r1')).not.toBe(streamLogKey('uB', 'r1'));
  });

  it('produces the same key for the same user+room (cache hit on re-login)', () => {
    expect(streamLogKey('uA', 'r1')).toBe(streamLogKey('uA', 'r1'));
  });

  it('key contains the userId so a cross-account lookup cannot match', () => {
    const key = streamLogKey('uA', 'r1');
    expect(key).toContain('uA');
    expect(key).toContain('r1');
  });
});

describe('loadStreamLog — cross-account isolation', () => {
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    configureKv({
      get: async (k) => mem.get(k) ?? null,
      set: async (k, v) => { mem.set(k, v); },
      remove: async (k) => { mem.delete(k); },
    });
  });

  it('returns [] for user B when only user A has a persisted blob for the same room', async () => {
    // Persist a blob under user A's key.
    const aKey = streamLogKey('uA', 'dm-space-dm');
    mem.set(aKey, JSON.stringify([{ ts: 1, data: {} }]));

    // User B loading the same room must NOT see user A's blob.
    const result = await loadStreamLog('uB', 'dm-space-dm');
    expect(result).toEqual([]);
  });

  it('returns the persisted blob for the correct user', async () => {
    const aKey = streamLogKey('uA', 'dm-space-dm');
    const items = [{ ts: 999, data: {} }];
    mem.set(aKey, JSON.stringify(items));

    const result = await loadStreamLog('uA', 'dm-space-dm');
    expect(result).toHaveLength(1);
    expect(result[0]!.ts).toBe(999);
  });
});
