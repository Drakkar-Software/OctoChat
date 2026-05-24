/**
 * Space membership (space-wide keyring model).
 *
 * A *join request* is just the invitee's identity (Ed/KEM pubkeys + userId). An
 * *invite* makes them a member of a whole SPACE: they're added to the space's one
 * keyring (so they can decrypt every channel) and to its owner-written roster (so
 * the server grants them `space:member`), and handed a single space-scoped cap.
 * Accepting verifies keyring access, stores the cap, and registers the space in
 * the invitee's own space list.
 */
import { addCollectionRecipient } from '@drakkar.software/starfish-keyring';
import { mintMemberCap } from '@drakkar.software/starfish-sharing';

import type { Space } from '@/lib/types';

import { buildEncryptor, makeClient, prefixedClient } from './client';
import type { Session } from './identity';
import { getMemberCap, saveMemberCap } from './member-caps';
import { keyringName, spaceMemberScope } from './paths';
import { addJoinedSpace, addSpaceMember, readSpaces } from './registry';

export interface JoinRequest {
  edPub: string;
  kemPub: string;
  userId: string;
}

/** The invitee shares this so a space owner can invite them. */
export function makeJoinRequest(session: Session): string {
  const req: JoinRequest = { edPub: session.keys.edPub, kemPub: session.keys.kemPub, userId: session.userId };
  return JSON.stringify(req);
}

interface SpaceInvite {
  spaceId: string;
  spaceName: string;
  cap: unknown;
}

/**
 * True when `addCollectionRecipient` failed only because the invitee is already
 * a recipient of the keyring's current epoch. The keyring SDK throws a plain
 * `Error` for this (no typed error is exported), so match its message — see
 * starfish-keyring `addRecipient`: "Recipient <kem> already present in epoch <n>".
 */
function isAlreadyPresentRecipient(err: unknown): boolean {
  return err instanceof Error && /already present in epoch/.test(err.message);
}

/**
 * Owner: invite an identity into a space. Adds them to the space keyring (one
 * keyring → all channels), records them in the roster (gates `space:member`),
 * and mints a single space-scoped member cap. Returns the invite bundle JSON.
 */
export async function inviteToSpace(
  session: Session,
  spaceId: string,
  requestJson: string,
  canWrite = true,
): Promise<string> {
  const req = JSON.parse(requestJson) as JoinRequest;
  if (!req.edPub || !req.kemPub || !req.userId) throw new Error('That is not a valid join request.');
  // 1. Add the invitee to the space keyring (covers every channel at once).
  // prefixedClient: the keyring SDK builds its own unprefixed `/pull|/push` paths,
  // so apply SYNC_PREFIX or the write 404s on the deployed `/v1/octochat` server.
  //
  // Re-invite tolerance: a member already wrapped into the keyring makes the SDK
  // throw "already present in epoch". That's the recover path — a member who lost
  // their LOCAL member cap (reinstall, or a new device from the same seed) is
  // still a keyring recipient; they just need a fresh cap to re-accept with. The
  // keyring add is a no-op for them, so swallow that one error and fall through
  // to re-mint the cap (step 3). Any other failure still propagates.
  try {
    await addCollectionRecipient(
      prefixedClient(session.chatClient),
      keyringName(spaceId),
      { subKem: req.kemPub, userId: req.userId, label: req.userId.slice(0, 8) },
      { edPriv: session.keys.edPriv, edPub: session.keys.edPub, kemPriv: session.keys.kemPriv },
      { trustedAdders: [session.keys.edPub] },
    );
  } catch (err) {
    if (!isAlreadyPresentRecipient(err)) throw err;
  }
  // 2. Record them in the space roster (owner-only write → grants space:member).
  await addSpaceMember(session.accountClient, spaceId, session.userId, req.userId);
  // 3. Mint one space-scoped cap covering all current + future channels.
  const cap = await mintMemberCap(
    session.keys.edPriv,
    session.keys.edPub,
    { edPubHex: req.edPub, kemPubHex: req.kemPub, userIdHex: req.userId },
    'chat',
    spaceMemberScope(spaceId, canWrite),
  );
  const { spaces } = await readSpaces(session.accountClient, session.userId);
  const spaceName = spaces.find((s) => s.id === spaceId)?.name ?? 'Space';
  const invite: SpaceInvite = { spaceId, spaceName, cap };
  return JSON.stringify(invite);
}

/**
 * Invitee: accept a space invite — verify keyring access with the cap, store it,
 * and register the space in your own list. Returns the joined space.
 */
export async function acceptSpaceInvite(session: Session, inviteJson: string): Promise<Space> {
  const inv = JSON.parse(inviteJson) as Partial<SpaceInvite>;
  const cap = inv.cap as { sub?: string; iss?: string } | undefined;
  if (!cap || !inv.spaceId) throw new Error('That is not a valid space invite.');
  if (cap.sub && cap.sub !== session.keys.edPub) {
    throw new Error('This invite was issued for a different identity.');
  }
  if (!cap.iss) throw new Error('This invite is missing its issuer.');
  const spaceId = inv.spaceId;
  const client = makeClient(cap, session.keys.edPriv);
  const enc = await buildEncryptor(client, session.keys, spaceId, [cap.iss]);
  if (!enc) throw new Error("Accepted, but you're not in the space keyring yet — ask the owner to re-invite.");
  saveMemberCap(spaceId, JSON.stringify(cap));
  const name = inv.spaceName?.trim() || `space-${spaceId.slice(-6)}`;
  const space: Space = { id: spaceId, name, short: name.slice(0, 2).toUpperCase(), members: 1 };
  await addJoinedSpace(session.accountClient, session.userId, space);
  return space;
}

export { getMemberCap };
