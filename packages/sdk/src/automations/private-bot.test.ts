import { describe, expect, it, vi } from 'vitest';
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';

import type { Session } from '../starfish/identity';
import { ephemeralUserId } from '../starfish/pubspace';

// The two NETWORK writes are stubbed (keyring re-seal + roster) so the round-trip runs without a
// server; mintMemberCap (pure signing) + sealToSelf/unsealFromSelf (pure crypto) stay REAL, and
// openEncryptor (a keyring pull) is stubbed so `openPrivateBot`'s unseal + wiring is exercised
// without one. Everything that matters for correctness — the bot bundle's integrity and that it
// only opens for the minting account — is real.
vi.mock('../starfish/members', async (orig) => ({
  ...(await orig<typeof import('../starfish/members')>()),
  addDeviceToSpaceKeyring: vi.fn(async () => {}),
}));
vi.mock('../starfish/registry', async (orig) => ({
  ...(await orig<typeof import('../starfish/registry')>()),
  addSpaceMember: vi.fn(async () => {}),
}));
vi.mock('../starfish/client', async (orig) => ({
  ...(await orig<typeof import('../starfish/client')>()),
  // makeClient reads runtime config (getSyncBase) which isn't wired in a unit test; stub it +
  // openEncryptor so the keyring-pull never hits the network.
  makeClient: vi.fn(() => ({ __client: true }) as never),
  openEncryptor: vi.fn(async () => 'ENC' as never),
}));

import { addDeviceToSpaceKeyring } from '../starfish/members';
import { openEncryptor } from '../starfish/client';
import { addSpaceMember } from '../starfish/registry';
import { unsealFromSelf } from '../starfish/account-seal';
import { openPrivateBot, provisionPrivateBot } from './private-bot';

// provisionPrivateBot/openPrivateBot use session.keys.* (crypto), session.userId, and the
// (stubbed) account/chat clients.
function ownerSession(): Session {
  return { keys: generateDeviceKeys(), userId: 'owner-user', accountClient: {}, chatClient: {} } as unknown as Session;
}

const SPACE = 'sp-test';

describe('provisionPrivateBot / openPrivateBot', () => {
  it('enrolls a fresh bot identity and seals a SELF-CONSISTENT, recoverable bundle', async () => {
    const session = ownerSession();
    const { credential: sealed, userId } = await provisionPrivateBot(session, SPACE);

    // The bot was enrolled into the space keyring + roster (the two owner-gated writes).
    expect(addDeviceToSpaceKeyring).toHaveBeenCalledTimes(1);
    expect(addSpaceMember).toHaveBeenCalledTimes(1);

    // The sealed blob opens for the OWNER and recovers a coherent bot identity.
    const bundle = JSON.parse(await unsealFromSelf(session, sealed)) as {
      keys: { edPub: string; kemPub: string; edPriv: string };
      userId: string;
      cap: { sub?: string; iss?: string };
    };
    // The returned userId (recorded as `botUserId` on the meta) matches the sealed bundle.
    expect(userId).toBe(bundle.userId);
    // userId is SHA-256(edPub) (the cheap ephemeral derivation — no Argon2 seed bootstrap).
    expect(bundle.userId).toBe(await ephemeralUserId(bundle.keys.edPub));
    // The owner-signed member cap binds the BOT's edPub and is issued by the OWNER.
    expect(bundle.cap.sub).toBe(bundle.keys.edPub);
    expect(bundle.cap.iss).toBe(session.keys.edPub);
    // The bot keyring re-seal targeted the bot's own KEM key + userId.
    expect(addDeviceToSpaceKeyring).toHaveBeenCalledWith(session, SPACE, {
      kemPub: bundle.keys.kemPub,
      userId: bundle.userId,
    });
  });

  it('openPrivateBot recovers the bot identity and opens the keyring trusting the OWNER', async () => {
    const session = ownerSession();
    const { credential: sealed } = await provisionPrivateBot(session, SPACE);
    const bundle = JSON.parse(await unsealFromSelf(session, sealed)) as { keys: unknown; userId: string };

    const { encryptor, userId } = await openPrivateBot(session, SPACE, sealed);
    expect(userId).toBe(bundle.userId);
    expect(encryptor).toBe('ENC');
    // trustedAdders is the OWNER's edPub (the keyring entries were owner-signed), and the bot's
    // OWN keypair unwraps the CEK.
    expect(openEncryptor).toHaveBeenCalledWith(expect.anything(), bundle.keys, SPACE, [session.keys.edPub]);
  });

  it("a DIFFERENT account cannot open the sealed bot credential", async () => {
    const owner = ownerSession();
    const other = ownerSession();
    const { credential: sealed } = await provisionPrivateBot(owner, SPACE);
    await expect(openPrivateBot(other, SPACE, sealed)).rejects.toThrow();
  });
});
