import { describe, expect, it } from 'vitest';

import { dmRoomId, dmWinner, isDmSpaceId, newDmSpaceId } from './dm-ids';
import { spaceIdFromRoomId } from './paths';

describe('dm-ids', () => {
  it('newDmSpaceId is dm-prefixed, unique, and recognized by isDmSpaceId', () => {
    const a = newDmSpaceId();
    const b = newDmSpaceId();
    expect(a.startsWith('dm-')).toBe(true);
    expect(a).not.toBe(b);
    expect(isDmSpaceId(a)).toBe(true);
    expect(isDmSpaceId('sp-abc')).toBe(false);
    expect(isDmSpaceId('psp-abc')).toBe(false);
  });

  it('dmRoomId round-trips back to its space through spaceIdFromRoomId', () => {
    const spaceId = newDmSpaceId();
    expect(spaceIdFromRoomId(dmRoomId(spaceId))).toBe(spaceId);
    // The reserved carrier id also round-trips (it lives in a normal sp- space).
    expect(spaceIdFromRoomId('sp-abc-_dminbox')).toBe('sp-abc');
  });

  describe('dmWinner (min-userId owns the surviving space)', () => {
    it('no competition → the inbound space wins', () => {
      expect(dmWinner('a', 'b', undefined, 'dm-peer')).toBe('dm-peer');
      expect(dmWinner('a', 'b', 'dm-peer', 'dm-peer')).toBe('dm-peer');
    });

    it('when I am the smaller userId, my own space wins', () => {
      // me='aaa' < peer='zzz' → keep my space.
      expect(dmWinner('aaa', 'zzz', 'dm-mine', 'dm-peer')).toBe('dm-mine');
    });

    it('when the peer is the smaller userId, their space wins', () => {
      // me='zzz' > peer='aaa' → adopt the peer's space.
      expect(dmWinner('zzz', 'aaa', 'dm-mine', 'dm-peer')).toBe('dm-peer');
    });

    it('both sides converge on the SAME winner regardless of who evaluates', () => {
      const me = 'user-1';
      const peer = 'user-2';
      const myA = 'dm-A'; // A created by user-1
      const myB = 'dm-B'; // B created by user-2
      // user-1's view: own=dm-A, inbound=dm-B
      const w1 = dmWinner(me, peer, myA, myB);
      // user-2's view: own=dm-B, inbound=dm-A
      const w2 = dmWinner(peer, me, myB, myA);
      expect(w1).toBe(w2); // same conversation on both sides
    });
  });
});
