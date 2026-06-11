/**
 * Unit tests for the hydrate-prune predicate in `unread-context.tsx`.
 *
 * The prune runs on cold start to drop orphan counts for spaces the user has left.
 * Key invariant: DM message rooms (`dm-<hex>-dm`) must survive the prune even when
 * the `dms` map hasn't loaded yet — the primed-spaces fast path in `spaces-context.tsx`
 * carries only the visible-space list, leaving `dms` empty until the background refresh
 * returns. Racing that prune against the empty `dms` set wiped every persisted DM unread
 * on every cold start.
 *
 * Tests import the same pure SDK functions the predicate uses so they stay in lockstep
 * with the real implementation.
 */
import { describe, expect, it } from 'vitest';

import { dmRoomId, isDmSpaceId, newDmSpaceId } from '@drakkar.software/octochat-sdk';
import { isDmInboxRoomId } from '@drakkar.software/octochat-sdk';
import { spaceIdFromRoomId } from '@drakkar.software/octochat-sdk';

/** The actual filter predicate used in `unread-context.tsx` (keep in sync). */
function shouldKeep(roomId: string, live: Set<string>): boolean {
  if (isDmInboxRoomId(roomId)) return false;
  const sp = spaceIdFromRoomId(roomId);
  return isDmSpaceId(sp) || live.has(sp);
}

describe('unread cold-start prune predicate', () => {
  const knownSpaceId = 'sp-abc123';
  const goneSpaceId = 'sp-gone00';
  // Simulate the primed-spaces fast path: live has regular spaces but NO DM spaces yet.
  const liveWithNoDms = new Set([knownSpaceId]);

  it('keeps a DM message room even when the dms map is not yet loaded (empty live set for DMs)', () => {
    const spaceId = newDmSpaceId(); // dm-<hex>
    const roomId = dmRoomId(spaceId); // dm-<hex>-dm
    expect(shouldKeep(roomId, liveWithNoDms)).toBe(true);
  });

  it('drops the DM-invite carrier room (_dminbox suffix)', () => {
    // The carrier lives inside a known regular space but is never a real room.
    const carrierId = `${knownSpaceId}-_dminbox`;
    expect(shouldKeep(carrierId, liveWithNoDms)).toBe(false);
  });

  it('keeps a regular channel room in a known space', () => {
    const roomId = `${knownSpaceId}-general`;
    expect(shouldKeep(roomId, liveWithNoDms)).toBe(true);
  });

  it('prunes a regular channel room whose space is no longer in the set (user left)', () => {
    const roomId = `${goneSpaceId}-general`;
    expect(shouldKeep(roomId, liveWithNoDms)).toBe(false);
  });

  it('survives even when live is fully empty (e.g. session just started, spaces not loaded)', () => {
    const spaceId = newDmSpaceId();
    const roomId = dmRoomId(spaceId);
    // An empty live set must not prune DM rooms.
    expect(shouldKeep(roomId, new Set())).toBe(true);
  });
});
