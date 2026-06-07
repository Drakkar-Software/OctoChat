import { describe, expect, it } from 'vitest';
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';

import { sealToRecipient, sealToSelf, unsealFromRecipient, unsealFromSelf } from './account-seal';
import type { Session } from './identity';

// sealToSelf/unsealFromSelf only touch session.keys.{edPub,edPriv,kemPub,kemPriv}.
function sessionWithKeys() {
  const keys = generateDeviceKeys();
  return { keys } as unknown as Session;
}

describe('account-seal: sealToSelf / unsealFromSelf', () => {
  it('round-trips a payload for the same account', async () => {
    const session = sessionWithKeys();
    const plaintext = JSON.stringify({ ownerId: 'o', cap: { a: 1 }, key: 'deadbeef', write: true });
    const blob = await sealToSelf(session, plaintext);
    // The sealed blob must NOT contain the plaintext bearer key in the clear.
    expect(JSON.stringify(blob)).not.toContain('deadbeef');
    expect(await unsealFromSelf(session, blob)).toBe(plaintext);
  });

  it('rejects a blob sealed by a DIFFERENT account (wrong key)', async () => {
    const a = sessionWithKeys();
    const b = sessionWithKeys();
    const blob = await sealToSelf(a, 'secret');
    await expect(unsealFromSelf(b, blob)).rejects.toThrow();
  });

  it('rejects a tampered ciphertext', async () => {
    const session = sessionWithKeys();
    const blob = await sealToSelf(session, 'secret');
    // Flip the last ciphertext byte → AES-GCM auth fails.
    const last = blob.ct.slice(-2);
    const flipped = (parseInt(last, 16) ^ 0xff).toString(16).padStart(2, '0');
    const tampered = { ...blob, ct: blob.ct.slice(0, -2) + flipped };
    await expect(unsealFromSelf(session, tampered)).rejects.toThrow();
  });
});

describe('account-seal: sealToRecipient / unsealFromRecipient', () => {
  it('A seals to B; only B opens it', async () => {
    const a = sessionWithKeys();
    const b = sessionWithKeys();
    const plaintext = JSON.stringify({ spaceId: 'dm-1', cap: { kind: 'member' } });
    const blob = await sealToRecipient(a, b.keys.kemPub, plaintext);
    expect(await unsealFromRecipient(b, blob)).toBe(plaintext);
    // The sealer's edPub is authenticated on the entry (used to cross-check the cap).
    expect(blob.entry.addedBy).toBe(a.keys.edPub);
  });

  it('a third party (wrong KEM key) cannot open it — the trial-unseal skip', async () => {
    const a = sessionWithKeys();
    const b = sessionWithKeys();
    const c = sessionWithKeys();
    const blob = await sealToRecipient(a, b.keys.kemPub, 'secret');
    await expect(unsealFromRecipient(c, blob)).rejects.toThrow();
  });

  it('rejects a blob whose signed sealer (addedBy) was tampered', async () => {
    const a = sessionWithKeys();
    const b = sessionWithKeys();
    const evil = sessionWithKeys();
    const blob = await sealToRecipient(a, b.keys.kemPub, 'secret');
    const tampered = { ...blob, entry: { ...blob.entry, addedBy: evil.keys.edPub } };
    await expect(unsealFromRecipient(b, tampered)).rejects.toThrow();
  });
});
