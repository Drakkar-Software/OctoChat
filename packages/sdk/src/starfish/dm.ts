/**
 * 1:1 Direct Messages — orchestration.
 *
 * A DM with a peer is a dedicated PRIVATE space the initiator owns, holding ONE room
 * (`kind:'dm'`). The peer is added with the EXISTING space-invite machinery
 * (`inviteToSpace`/`acceptSpaceInvite`), so message crypto is the normal space keyring
 * — nothing new. The only DM-specific plumbing is key discovery (`dm-keys.ts`), cap
 * DELIVERY through a shared space (`dm-inbox.ts`), and dedup via the `dms` map.
 *
 * DM spaces carry a `dm-` id prefix (random, NOT deterministic — so unguessable, no
 * TOFU squatting) so they're trivially distinguishable from normal `sp-` spaces: the
 * room list filters them out of the space rail and the simultaneous-create "loser"
 * orphan auto-hides, with no dependency on the `dms` map.
 */
import type { StarfishClient } from '@drakkar.software/starfish-client';

import type { DmMap, Space } from '../domain/types';

import { ensureRoomInitialized, ownerEnsureKeyring } from './client';
import { acceptSpaceInvite, inviteToSpace } from './members';
import { isPublicSpaceId } from './pubspace';
import { dmRoomId, dmWinner, isDmSpaceId, newDmSpaceId } from './dm-ids';
import { appendDmInvite, scanDmInbox } from './dm-inbox';
import type { PeerKeys } from './dm-keys';
import { ownerTrustedAdders, type Session } from './identity';
import { DEFAULT_CATEGORY } from './objects';
import { pushIndexSeed } from './object-index';
import { addJoinedSpace, readRooms, readSpaces, setDmMapping, writeRooms } from './registry';
import { getSpaceEncryptor } from './space-encryptor';

// Re-export the pure id/dedup helpers so existing importers can keep reaching for them
// through `starfish/dm` (their canonical home is the dependency-light `dm-ids`).
export { dmRoomId, dmWinner, isDmSpaceId } from './dm-ids';

export interface DmRef {
  spaceId: string;
  roomId: string;
}

/** Create a private DM space owned by this session: seed its keyring + the single
 *  `kind:'dm'` room doc, stamp ownership in `_rooms`, and record the space locally.
 *  The peer is added separately via {@link inviteToSpace} (keyring + roster + cap). */
async function createDmSpace(session: Session, peerPseudo: string): Promise<DmRef> {
  const spaceId = newDmSpaceId();
  const roomId = dmRoomId(spaceId);
  // Seed the space keyring (owner = this session) and the room's empty encrypted doc.
  const enc = await ownerEnsureKeyring(session.chatClient, session.keys, spaceId, ownerTrustedAdders(session));
  await ensureRoomInitialized(session.chatClient, enc, roomId);
  // Claim ownership (TOFU first write) in the access record; members start empty
  // (inviteToSpace adds the peer to the roster). The single `kind:'dm'` room now lives
  // in the encrypted object index — seed it with the keyring we just opened.
  await writeRooms(session.chatClient, spaceId, session.userId, [], null, { name: peerPseudo });
  await pushIndexSeed(session.chatClient, enc, spaceId, [{ id: roomId, name: peerPseudo, kind: 'dm', category: DEFAULT_CATEGORY }]);
  // Record in our own space list (filtered out of the rail by isDmSpaceId). The stored
  // name is cosmetic — the DM list always derives the peer's pseudo per viewer.
  const space: Space = { id: spaceId, name: peerPseudo, short: peerPseudo.slice(0, 2).toUpperCase(), members: 2 };
  await addJoinedSpace(session.accountClient, session.userId, space);
  return { spaceId, roomId };
}

/**
 * Resolve a shared PRIVATE space this session co-inhabits with `peerUserId` — the
 * carrier for delivering the DM invite. Public (`psp-`) and DM (`dm-`) spaces are
 * skipped (a DM invite must ride an E2EE space's member-writable stream; a public space
 * is plaintext and has no roster). Returns the first match's id, or null.
 */
export async function findSharedSpaceWith(
  session: Session,
  peerUserId: string,
  knownSpaces: Space[],
): Promise<string | null> {
  const me = session.userId;
  for (const s of knownSpaces) {
    if (isPublicSpaceId(s.id) || isDmSpaceId(s.id) || s.type === 'public') continue;
    try {
      const { owner, members } = await readRooms(session.accountClient, s.id);
      const roster = new Set<string>([owner ?? '', ...members].filter(Boolean));
      if (roster.has(me) && roster.has(peerUserId)) return s.id;
    } catch {
      /* unreadable space — skip */
    }
  }
  return null;
}

/**
 * Open the existing DM with `peerUserId`, or create one. Idempotent: a prior mapping in
 * the `dms` map short-circuits to the existing space. Otherwise create a DM space, add
 * the peer via the existing invite machinery, record the mapping, and DELIVER the
 * invite by sealing it into the shared space's carrier so the peer's reconciler accepts
 * it. `sharedSpaceId` is the carrier (from {@link findSharedSpaceWith}).
 */
export async function createOrOpenDm(
  session: Session,
  peerUserId: string,
  peerKeys: PeerKeys,
  peerPseudo: string,
  sharedSpaceId: string,
): Promise<DmRef> {
  // Dedup against fresh server state (covers a DM created on another device).
  const { dms } = await readSpaces(session.accountClient, session.userId);
  const existing = dms[peerUserId];
  if (existing) return { spaceId: existing, roomId: dmRoomId(existing) };

  const ref = await createDmSpace(session, peerPseudo);
  // Reuse the whole space-invite flow (keyring recipient + roster + member cap). It
  // builds the same SpaceInvite JSON acceptSpaceInvite consumes, reading the space name
  // we just stored for the bundle.
  const requestJson = JSON.stringify({ edPub: peerKeys.edPub, kemPub: peerKeys.kemPub, userId: peerUserId });
  const inviteJson = await inviteToSpace(session, ref.spaceId, requestJson, true);
  await setDmMapping(session.accountClient, session.userId, peerUserId, ref.spaceId);
  // Deliver: seal the invite to the peer and append it to the shared space's carrier.
  const { client } = await getSpaceEncryptor(sharedSpaceId, session, null);
  await appendDmInvite(session, client, sharedSpaceId, peerKeys.kemPub, inviteJson);
  return ref;
}

/**
 * Rebuild the peer→DM-space map from the PERSISTED `dm-` spaces in the registry.
 *
 * The `dms` map is only a convenience index — it rides the shared `_spaces` doc and can
 * lag or be lost (e.g. a clobbered read-modify-write, a dropped sibling key). The dm-
 * SPACES themselves persist on the SAME reliable path as every other joined space
 * (`addJoinedSpace` / `addJoinedSpaceWithCap`), so they're the durable source of truth.
 *
 * For any `dm-` space present in `rawSpaces` but absent from the map, read its roster,
 * find the peer (the one roster member that isn't us), map it, and persist the mapping
 * (best-effort) so the index self-heals across devices. Returns the (possibly extended)
 * map — same reference when nothing changed. Never throws.
 *
 * `rawSpaces` MUST be the UNFILTERED space list (dm- spaces still included), not the
 * rail-filtered one.
 */
export async function healDmMap(session: Session, rawSpaces: Space[], dmMap: DmMap): Promise<DmMap> {
  const mappedSpaceIds = new Set(Object.values(dmMap));
  const orphans = rawSpaces.filter((s) => isDmSpaceId(s.id) && !mappedSpaceIds.has(s.id));
  if (orphans.length === 0) return dmMap;
  const healed: DmMap = { ...dmMap };
  for (const s of orphans) {
    try {
      const { owner, members } = await readRooms(session.accountClient, s.id);
      // Owner is the creator; members holds the other side. The peer is whichever
      // roster entry isn't us (works from both the creator's and the invitee's view).
      const peer = [owner ?? '', ...members].find((u) => u && u !== session.userId);
      if (!peer || healed[peer]) continue; // unknown peer, or peer already mapped — skip
      healed[peer] = s.id;
      void setDmMapping(session.accountClient, session.userId, peer, s.id).catch(() => {});
    } catch {
      /* unreadable dm space — skip, try again next refresh */
    }
  }
  return healed;
}

/**
 * Scan the DM-invite carriers in every shared private space, accept new invites
 * (verifying the cap binds to this identity), and record peer→space mappings — applying
 * the {@link dmWinner} rule when we ALSO created our own space for that peer. Returns
 * true if any mapping changed (so the caller can refresh the DM list).
 *
 * Best-effort throughout: an unreadable space, a poisoned carrier element, or a single
 * un-acceptable invite is skipped, never fatal.
 */
export async function reconcileDmInbox(session: Session, knownSpaces: Space[]): Promise<boolean> {
  const { dms, caps } = await readSpaces(session.accountClient, session.userId);
  // Skip invites for spaces we've already joined (mapped, or holding a member cap).
  const accepted = new Set<string>([...Object.values(dms), ...Object.keys(caps)]);
  let changed = false;
  for (const s of knownSpaces) {
    if (isPublicSpaceId(s.id) || isDmSpaceId(s.id) || s.type === 'public') continue;
    let client: StarfishClient;
    try {
      ({ client } = await getSpaceEncryptor(s.id, session, null));
    } catch {
      continue; // can't open this shared space's keyring — skip its carrier
    }
    const invites = await scanDmInbox(session, client, s.id, accepted).catch(() => []);
    for (const inv of invites) {
      // The DM space's authoritative owner (the peer who invited us) — server-gated, so
      // it can't be forged. We're already in its roster (the inviter added us), so we
      // can read it before fully accepting.
      let peerUserId: string | null;
      try {
        peerUserId = (await readRooms(session.accountClient, inv.spaceId)).owner;
      } catch {
        continue;
      }
      if (!peerUserId) continue;
      const winner = dmWinner(session.userId, peerUserId, dms[peerUserId], inv.spaceId);
      if (winner !== inv.spaceId) continue; // our own space wins — ignore the loser (don't accept it)
      try {
        await acceptSpaceInvite(session, inv.inviteJson); // idempotent; verifies cap.sub === self
      } catch {
        continue; // not actually bound to us / keyring not shared — skip
      }
      if (dms[peerUserId] !== inv.spaceId) {
        await setDmMapping(session.accountClient, session.userId, peerUserId, inv.spaceId);
        dms[peerUserId] = inv.spaceId; // reflect locally so a later invite in this run dedups
        accepted.add(inv.spaceId);
        changed = true;
      }
    }
  }
  return changed;
}
