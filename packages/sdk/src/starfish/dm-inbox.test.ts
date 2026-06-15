import { describe, expect, it, vi } from 'vitest';
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';

import { sealToRecipient } from './account-seal';
import { dmInboxRoomId, isDmInboxRoomId, scanDmInbox, scanDmLinkInbox } from './dm-inbox';
import type { Session } from './identity';
import { dmInboxShards } from './paths';

function sess(): Session {
  return { keys: generateDeviceKeys(), userId: 'u-me' } as unknown as Session;
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

  it('scanDmLinkInbox scans my current+previous month shards and trial-unseals them', async () => {
    const me = sess();
    const visitor = sess();
    const [curShard, prevShard] = dmInboxShards();
    const forMe = { sealed: await sealToRecipient(visitor, me.keys.kemPub, invite('dm-link-1')), ts: 1 };
    const notForMe = { sealed: await sealToRecipient(visitor, sess().keys.kemPub, invite('dm-link-2')), ts: 2 };
    // The invite lives in the current shard; the previous shard is empty.
    const pull = vi.fn(async (path: string) =>
      path === `/pull/inbox/u-me/${curShard}` ? [forMe, notForMe].map((data, i) => ({ ts: i, data })) : [],
    );
    (me as { accountClient?: unknown }).accountClient = { pull };
    const res = await scanDmLinkInbox(me);
    expect(res.map((r) => r.spaceId)).toEqual(['dm-link-1']);
    expect(res[0]!.senderEdPub).toBe(visitor.keys.edPub);
    // Pulled BOTH shard paths for THIS user.
    const paths = pull.mock.calls.map((c) => c[0]);
    expect(paths).toContain(`/pull/inbox/u-me/${curShard}`);
    expect(paths).toContain(`/pull/inbox/u-me/${prevShard}`);
  });

  it('scanDmLinkInbox returns [] when a shard pull rejects (e.g. a stale paired-device cap 403s)', async () => {
    const me = sess();
    (me as { accountClient?: unknown }).accountClient = {
      pull: vi.fn(async () => {
        throw new Error('403');
      }),
    };
    expect(await scanDmLinkInbox(me)).toEqual([]);
  });
});
