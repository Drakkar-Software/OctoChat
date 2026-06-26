import { describe, expect, it } from 'vitest';

import { computeDmUnreadSeed, totalDmUnread } from './dm-unread';

// ── totalDmUnread ────────────────────────────────────────────────────────────────

describe('totalDmUnread', () => {
  it('sums over dmSpaceIds even when dms peer-map is empty (the core bug)', () => {
    // Before the fix, an empty `dms` map meant the total was always 0 even when
    // unreadByRoom had bumped DM rooms via the SSE stream.
    expect(
      totalDmUnread(
        ['dm-a', 'dm-b'],
        {}, // empty lossy peer-map — the cold-start case
        { 'dm-a-dm': 3, 'dm-b-dm': 1 },
      ),
    ).toBe(4);
  });

  it('returns 0 when there are no DM spaces', () => {
    expect(totalDmUnread([], {}, { 'dm-a-dm': 5 })).toBe(0);
  });

  it('returns 0 when there are no unread rooms', () => {
    expect(totalDmUnread(['dm-a', 'dm-b'], {}, {})).toBe(0);
  });

  it('unions dms values not present in dmSpaceIds (freshly-healed DM not yet in list)', () => {
    // 'dm-c' only comes from the peer-map, not from dmSpaceIds
    expect(
      totalDmUnread(
        ['dm-a'],
        { 'user-c': 'dm-c' }, // peer-map carries a new DM that hasn't hit dmSpaceIds yet
        { 'dm-a-dm': 2, 'dm-c-dm': 7 },
      ),
    ).toBe(9);
  });

  it('de-duplicates when a space id appears in both dmSpaceIds and dms values', () => {
    // 'dm-a' is in both — must be counted only once
    expect(
      totalDmUnread(
        ['dm-a', 'dm-b'],
        { 'user-a': 'dm-a' }, // dm-a also in peer-map
        { 'dm-a-dm': 3, 'dm-b-dm': 1 },
      ),
    ).toBe(4); // not 7 (would be wrong if dm-a counted twice)
  });

  it('ignores unread for rooms not in the DM space set', () => {
    expect(
      totalDmUnread(
        ['dm-a'],
        {},
        { 'dm-a-dm': 2, 'sp-other-general': 99 },
      ),
    ).toBe(2);
  });
});

// ── computeDmUnreadSeed ──────────────────────────────────────────────────────────

describe('computeDmUnreadSeed', () => {
  it('seeds 1 when head is newer than read mark and no count exists', () => {
    const result = computeDmUnreadSeed(
      ['dm-a'],
      { 'dm-a-dm': 1000 }, // head ts
      { 'dm-a-dm': 500 },  // read mark older than head
      {},                  // no live count yet
    );
    expect(result).toEqual({ 'dm-a-dm': 1 });
  });

  it('returns null when nothing needs seeding (all caught up)', () => {
    const result = computeDmUnreadSeed(
      ['dm-a', 'dm-b'],
      { 'dm-a-dm': 500, 'dm-b-dm': 800 },
      { 'dm-a-dm': 600, 'dm-b-dm': 900 }, // read marks AHEAD of heads
      {},
    );
    expect(result).toBeNull();
  });

  it('skips rooms where read mark equals head (already caught up)', () => {
    const result = computeDmUnreadSeed(
      ['dm-a'],
      { 'dm-a-dm': 1000 },
      { 'dm-a-dm': 1000 }, // read mark == head
      {},
    );
    expect(result).toBeNull();
  });

  it('skips rooms that already have a live count (no clobber, no double-count)', () => {
    const result = computeDmUnreadSeed(
      ['dm-a'],
      { 'dm-a-dm': 1000 },
      { 'dm-a-dm': 500 },
      { 'dm-a-dm': 3 }, // live SSE bump already counted 3
    );
    // Must not overwrite the 3 with 1
    expect(result).toBeNull();
  });

  it('seeds only rooms that need it, leaves existing counts untouched', () => {
    const result = computeDmUnreadSeed(
      ['dm-a', 'dm-b', 'dm-c'],
      { 'dm-a-dm': 1000, 'dm-b-dm': 200, 'dm-c-dm': 500 },
      { 'dm-a-dm': 500,  'dm-b-dm': 300, 'dm-c-dm': 400 },
      //   dm-a: head>read, no count → seed
      //   dm-b: read>head → skip
      //   dm-c: head>read, already has count below → this is no count case
      { 'dm-c-dm': 2 },
    );
    // dm-a seeded, dm-b skipped (caught up), dm-c skipped (live count exists)
    expect(result).toEqual({ 'dm-a-dm': 1, 'dm-c-dm': 2 });
  });

  it('returns null when dmSpaceIds is empty', () => {
    expect(computeDmUnreadSeed([], { 'dm-a-dm': 1000 }, {}, {})).toBeNull();
  });

  it('treats a missing head as 0 (no seed when head is unknown)', () => {
    const result = computeDmUnreadSeed(
      ['dm-a'],
      {},          // no head known
      {},          // no read mark either
      {},
    );
    // head(0) === read(0) → no seed
    expect(result).toBeNull();
  });

  it('treats a missing read mark as 0 (seeds when head > 0 and never read)', () => {
    const result = computeDmUnreadSeed(
      ['dm-a'],
      { 'dm-a-dm': 500 },
      {},   // never read
      {},
    );
    expect(result).toEqual({ 'dm-a-dm': 1 });
  });
});
