import { describe, expect, it } from 'vitest';
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';

import { sealToSelf } from './account-seal';
import { openStreamBotCredential, type StreamBotCredential } from './stream-bots';
import type { Session } from './identity';

// openStreamBotCredential only touches session.keys.{edPub,edPriv,kemPub,kemPriv}.
function sessionWithKeys() {
  const keys = generateDeviceKeys();
  return { keys } as unknown as Session;
}

const CRED: StreamBotCredential = {
  token: 'lnk.deadbeef',
  endpoint: 'https://sync.test/v1/ns/push/x',
  signPath: '/push/x',
  expiresAt: 1234,
};

describe('openStreamBotCredential', () => {
  it('round-trips a sealed credential for the minting account', async () => {
    const session = sessionWithKeys();
    const sealed = await sealToSelf(session, JSON.stringify(CRED));
    // The bearer token must not appear in the clear in the synced blob.
    expect(JSON.stringify(sealed)).not.toContain('deadbeef');
    expect(await openStreamBotCredential(session, sealed)).toEqual(CRED);
  });

  it('returns a LEGACY plaintext credential as-is (no unseal)', async () => {
    const session = sessionWithKeys();
    // A pre-seal room stored the bare credential; detected by its `token`.
    expect(await openStreamBotCredential(session, CRED)).toEqual(CRED);
  });

  it('cannot be opened by a different keypair (e.g. a QR-paired device)', async () => {
    const minting = sessionWithKeys();
    const paired = sessionWithKeys(); // fresh keys, like a paired device
    const sealed = await sealToSelf(minting, JSON.stringify(CRED));
    await expect(openStreamBotCredential(paired, sealed)).rejects.toThrow();
  });
});
