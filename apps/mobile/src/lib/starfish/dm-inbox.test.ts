import { describe, expect, it, vi } from 'vitest';
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';

import { sealToRecipient } from './account-seal';
import { dmInboxRoomId, isDmInboxRoomId, scanDmInbox } from './dm-inbox';
import type { Session } from './identity';

function sess(): Session {
  return { keys: generateDeviceKeys() } as unknown as Session;
}
const invite = (spaceId: string) => JSON.stringify({ spaceId, spaceName: 'x', cap: { kind: 'member' } });

describe('dm-inbox', () => {
  it('carrier id round-trips and is recognized', () => {
    expect(dmInboxRoomId('sp-1')).toBe('sp-1-_dminbox');
    expect(isDmInboxRoomId('sp-1-_dminbox')).toBe(true);
    expect(isDmInboxRoomId('sp-1-general')).toBe(false);
  });

  it('scanDmInbox returns only invites this session can trial-unseal; skips accepted + malformed', async () => {
    const me = sess();
    const peer = sess();
    const other = sess();
    const forMe = { sealed: await sealToRecipient(peer, me.keys.kemPub, invite('dm-1')), ts: 1 };
    const alreadyAccepted = { sealed: await sealToRecipient(peer, me.keys.kemPub, invite('dm-acc')), ts: 2 };
    const forOther = { sealed: await sealToRecipient(peer, other.keys.kemPub, invite('dm-2')), ts: 3 };
    const malformed = { ts: 4 }; // no `sealed`
    const items = [forMe, alreadyAccepted, forOther, malformed].map((data, i) => ({ ts: i, data }));
    const client = { pull: vi.fn(async () => items) } as never;

    const res = await scanDmInbox(me, client, 'sp-shared', new Set(['dm-acc']));
    // Only dm-1: dm-acc is already accepted, dm-2 is sealed to someone else, malformed is skipped.
    expect(res.map((r) => r.spaceId)).toEqual(['dm-1']);
    // The authenticated sealer is surfaced for the cap cross-check.
    expect(res[0]!.senderEdPub).toBe(peer.keys.edPub);
  });

  it('returns [] when the carrier pull rejects (never throws)', async () => {
    const me = sess();
    const client = {
      pull: vi.fn(async () => {
        throw new Error('offline');
      }),
    } as never;
    expect(await scanDmInbox(me, client, 'sp-shared')).toEqual([]);
  });
});
