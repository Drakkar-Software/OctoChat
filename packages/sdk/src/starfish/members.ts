/**
 * Space membership — re-exports the generic invite/keyring surface from the SDK.
 *
 * `acceptSpaceInvite` is kept OctoChat-local because it performs a live keyring-access
 * pre-check (via `buildEncryptor`) that the SDK version omits: it fails early with
 * "ask the owner to re-invite" instead of silently succeeding without decryption access.
 * It also uses `session.spacesRegistryClient` for the `_spaces` doc write.
 */
export type { JoinRequest } from '@drakkar.software/octospaces-sdk';
export { makeJoinRequest, inviteToSpace, addDeviceToSpaceKeyring } from '@drakkar.software/octospaces-sdk';

import type { Space } from '../domain/types';
import { addJoinedSpaceWithCap, saveSpaceAccessEntry } from '@drakkar.software/octospaces-sdk';
import { buildEncryptor, makeClient } from './client';
import type { Session } from './identity';

interface SpaceInvite {
  spaceId: string;
  spaceName: string;
  cap: unknown;
}

/**
 * Invitee: accept a space invite — verify keyring access with the cap, store it,
 * and register the space in your own list. Returns the joined space.
 */
export async function acceptSpaceInvite(session: Session, inviteJson: string): Promise<Space> {
  const inv = JSON.parse(inviteJson) as Partial<SpaceInvite>;
  const cap = inv.cap as { kind?: string; sub?: string; iss?: string } | undefined;
  if (!cap || !inv.spaceId) throw new Error('That is not a valid space invite.');
  // Fail closed: a space invite MUST be a member cap bound to THIS identity. The
  // server also rejects a malformed/sub-less cap, but the client should not trust an
  // invite blob enough to open the keyring for it before checking the binding.
  if (cap.kind !== 'member') throw new Error('That is not a valid space invite.');
  if (!cap.sub || cap.sub !== session.keys.edPub) {
    throw new Error('This invite was issued for a different identity.');
  }
  if (!cap.iss) throw new Error('This invite is missing its issuer.');
  const spaceId = inv.spaceId;
  const client = makeClient(cap, session.keys.edPriv);
  const enc = await buildEncryptor(client, session.keys, spaceId, [cap.iss]);
  if (!enc) throw new Error("Accepted, but you're not in the space keyring yet — ask the owner to re-invite.");
  const capJson = JSON.stringify(cap);
  const name = inv.spaceName?.trim() || `space-${spaceId.slice(-6)}`;
  const space: Space = { id: spaceId, name, short: name.slice(0, 2).toUpperCase(), members: 1 };
  // Persist the joined space AND its cap together in the user's own `_spaces` doc FIRST
  // (the durable source of truth — re-hydrates on a fresh device, so it self-heals with
  // no owner re-invite). Only mirror into the in-memory cache once that write succeeds,
  // so a failed push never leaves a "joined locally, not on the server" state.
  await addJoinedSpaceWithCap(session.spacesRegistryClient, session.userId, space, capJson);
  saveSpaceAccessEntry(spaceId, { kind: 'member', cap: capJson });
  return space;
}
