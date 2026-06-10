/**
 * PRIVATE-space automation bot identity.
 *
 * A public-space automation posts via a `pubstream` audience cap ({@link createStreamBotCredential})
 * — but an audience cap grants WRITE authority, never DECRYPTION, so it's useless in an E2EE
 * space. Instead, the owner provisions a distinct **bot identity** and enrolls it as a real
 * keyring member of the space, exactly like inviting a person ({@link inviteToSpace}): a fresh
 * keypair added as a keyring recipient + an owner-signed member cap. The bot's identity material
 * is then sealed to the owner's account key ({@link sealToSelf}) and stored in the room's
 * `AutomationMeta.credential` — the SAME field the public audience-cap credential uses — so the
 * runner (always the owner's seed device) can later open it and post AS the bot.
 *
 * Why a separate identity (not just post as the owner): the bot gets its own `authorId`, so the
 * owner still receives push + unread for the automation's output (self-exclusion keys on author
 * identity — see push/unread self-exclusion). That matches public-space behavior.
 *
 * The bot is a CHEAP ephemeral identity — `generateDeviceKeys()` + `SHA-256(edPub)` userId
 * (the {@link ephemeralUserId} derivation) — NOT a seed identity, so it avoids the slow Argon2
 * root bootstrap (which froze the web UI; see the ephemeral-key note).
 *
 * Device limitation (consistent with the public bot credential + DM keyring): the sealed blob
 * binds to the seed-derived account key, so it opens on the minting device or a seed-restored
 * device — NOT a QR-paired device (fresh keypair). Manage/run private automations from a primary
 * (seed-entry) device.
 */
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';
import { mintMemberCap } from '@drakkar.software/starfish-sharing';
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import { sealToSelf, unsealFromSelf, type SealedBlob } from '../starfish/account-seal';
import { makeClient, openEncryptor, type DeviceKeys } from '../starfish/client';
import type { Session } from '../starfish/identity';
import { addDeviceToSpaceKeyring } from '../starfish/members';
import { spaceMemberScope } from '../starfish/paths';
import { ephemeralUserId } from '../starfish/pubspace';
import { addSpaceMember } from '../starfish/registry';

/** The bot identity material we seal into `AutomationMeta.credential` for a private automation. */
interface PrivateBotCredential {
  keys: DeviceKeys;
  userId: string;
  /** The owner-signed, space-scoped member cap binding the bot's edPub. */
  cap: unknown;
}

/**
 * Owner-side, one-time at automation create: mint a fresh bot identity, enroll it as a keyring
 * recipient + roster member of `spaceId`, issue it an owner-signed write cap, and return the
 * whole bundle SEALED to the owner's account key (the caller stores it in
 * `AutomationMeta.credential`). The cap is space-scoped (covers every room), so one bot per
 * automated room is purely a labeling choice — each room gets its own distinct `authorId`.
 *
 * `session` MUST own the space (the keyring re-seal + roster write are `space:owner`-gated).
 * Returns the sealed `credential` (for `AutomationMeta.credential`) AND the bot's `userId` in
 * the clear (for `AutomationMeta.botUserId`, so member UIs can filter the bot out of the roster
 * it was just added to).
 */
export async function provisionPrivateBot(
  session: Session,
  spaceId: string,
): Promise<{ credential: SealedBlob; userId: string }> {
  const keys = generateDeviceKeys();
  const userId = await ephemeralUserId(keys.edPub);
  // 1. Add the bot's KEM key as a keyring recipient (owner-signed re-seal of the room key).
  await addDeviceToSpaceKeyring(session, spaceId, { kemPub: keys.kemPub, userId });
  // 2. Record the bot in the space roster (owner-only write → grants it `space:member`).
  await addSpaceMember(session.accountClient, spaceId, session.userId, userId);
  // 3. Mint a space-scoped, write-enabled member cap bound to the bot's edPub.
  const cap = await mintMemberCap(
    session.keys.edPriv,
    session.keys.edPub,
    { edPubHex: keys.edPub, kemPubHex: keys.kemPub, userIdHex: userId },
    'chat',
    spaceMemberScope(spaceId, true),
  );
  const bundle: PrivateBotCredential = { keys, userId, cap };
  return { credential: await sealToSelf(session, JSON.stringify(bundle)), userId };
}

/**
 * Runner-side: open a sealed private-bot credential into a working `{ client, encryptor, userId }`
 * the tick can encrypt + append with. Mirrors `acceptSpaceInvite`'s open path
 * (`makeClient` + keyring open) but for the bot identity instead of the logged-in user.
 *
 * `trustedAdders = [owner edPub]`: the keyring entries were signed by the owner
 * ({@link addDeviceToSpaceKeyring}), and the runner IS the owner, so `session.keys.edPub` is
 * exactly that signer. Throws (→ tick 'failed') on a non-seed device that can't unseal the blob.
 */
export async function openPrivateBot(
  session: Session,
  spaceId: string,
  sealed: SealedBlob,
): Promise<{ client: StarfishClient; encryptor: Encryptor; userId: string }> {
  const { keys, userId, cap } = JSON.parse(await unsealFromSelf(session, sealed)) as PrivateBotCredential;
  const client = makeClient(cap, keys.edPriv);
  const encryptor = await openEncryptor(client, keys, spaceId, [session.keys.edPub]);
  return { client, encryptor, userId };
}
