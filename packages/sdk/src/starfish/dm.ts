/**
 * 1:1 Direct Messages — orchestration.
 *
 * A DM with a peer is a dedicated PRIVATE space the initiator owns, holding ONE room
 * (`kind:'dm'`). The peer is added with the EXISTING space-invite machinery
 * (`inviteToSpace`/`acceptSpaceInvite`), so message crypto is the normal space keyring
 * — nothing new. The only DM-specific plumbing is key discovery (`dm-keys.ts`), cap
 * DELIVERY — through a shared space's carrier (`dm-inbox.ts`) or, with no space in
 * common, the recipient's DM-link inbox (`dm-link.ts`) — and dedup via the `dms` map.
 *
 * DM spaces carry a `dm-` id prefix (random, NOT deterministic — so unguessable, no
 * TOFU squatting) so they're trivially distinguishable from normal `sp-` spaces: the
 * room list filters them out of the space rail and the simultaneous-create "loser"
 * orphan auto-hides, with no dependency on the `dms` map.
 */
import type { StarfishClient } from '@drakkar.software/starfish-client';

import type { DmMap, Space } from '../domain/types';

import { getSpaceClient, ownerEnsureKeyring } from '@drakkar.software/octospaces-sdk';
import { keyringPull, keyringPush } from './paths';
import { acceptSpaceInvite, inviteToSpace } from './members';
import { dmRoomId, dmWinner, isDmSpaceId, newDmSpaceId } from './dm-ids';
import { appendDmInvite, scanDmInbox, scanDmLinkInbox } from './dm-inbox';
import type { PeerKeys } from './dm-keys';
import { ownerTrustedAdders, type Session } from './identity';
import { DEFAULT_CATEGORY } from './objects';
import { pushIndexSeed } from './object-index';
import { addJoinedSpace, addSpaceMember, readSpaceAccess, readSpaces, setDmMapping, writeSpaceAccess } from './registry';

// Re-export the pure id/dedup helpers so existing importers can keep reaching for them
// through `starfish/dm` (their canonical home is the dependency-light `dm-ids`).
export { dmRoomId, dmWinner, isDmSpaceId } from './dm-ids';

export interface DmRef {
  spaceId: string;
  roomId: string;
}

/** Create a private DM space owned by this session — keyring + ownership stamp +
 *  the single `kind:'dm'` room node — WITHOUT registering it in the session's own
 *  space list. The link flow ({@link createDmViaLink}) registers only after invite
 *  DELIVERY succeeds, so a failed delivery leaves an unreferenced (harmless,
 *  unguessable-id) `_rooms`/keyring orphan rather than a ghost DM — the posture
 *  {@link createSpace} documents for a failed seed. Invisible to {@link healDmMap},
 *  which scans only `_spaces` entries. */
export async function createDmSpaceCore(session: Session, peerPseudo: string, peerUserId?: string): Promise<DmRef> {
  const spaceId = newDmSpaceId();
  const roomId = dmRoomId(spaceId);
  // Seed the space keyring (owner = this session) — required so E2EE DM messages can
  // be encrypted. The DM room itself is an append-only log (the `streamchat` collection).
  await ownerEnsureKeyring(session.contentClient, session.keys, keyringPull(spaceId), keyringPush(spaceId), ownerTrustedAdders(session));
  // Claim ownership AND seed the peer into the roster in ONE owner write. The /events SSE
  // proxy + FCM bridge authorize a space purely from `_access.{owner,members}` (the strict
  // no-TOFU enricher — caps are ignored there), so a DM whose peer is missing from this
  // roster gets NO live notifications/unread even though message READS still work (cap-gated).
  // Writing `members` here — instead of the later read-modify-write `addSpaceMember` inside
  // `inviteToSpace` — avoids a read-after-write race that could drop the peer; that
  // addSpaceMember then no-ops. `healDmRosters` repairs DMs created before this seeding.
  await writeSpaceAccess(session.contentClient, spaceId, session.userId, peerUserId ? [peerUserId] : [], null, { name: peerPseudo });
  // enc:true: DM messages are sealed with the space keyring (streamchat); the client
  // must open the encryptor to decrypt them. access is 'space' (default — DM-space
  // members only), so no explicit access field is needed.
  await pushIndexSeed(session.contentClient, spaceId, [{ id: roomId, name: peerPseudo, kind: 'dm', category: DEFAULT_CATEGORY, enc: true }]);
  return { spaceId, roomId };
}

/** The {@link Space} record a DM space stores in the owner's `_spaces` list (filtered
 *  out of the rail by isDmSpaceId). The stored name is cosmetic — the DM list always
 *  derives the peer's pseudo per viewer. */
export function dmSpaceRecord(spaceId: string, peerPseudo: string): Space {
  return { id: spaceId, name: peerPseudo, short: peerPseudo.slice(0, 2).toUpperCase(), members: 2 };
}

/** Create a private DM space owned by this session: seed its keyring + the single
 *  `kind:'dm'` room doc, stamp ownership in `_rooms`, and record the space locally.
 *  The peer is seeded into the access roster at creation; their keyring slot + member
 *  cap are added via {@link inviteToSpace}. */
async function createDmSpace(session: Session, peerPseudo: string, peerUserId: string): Promise<DmRef> {
  const ref = await createDmSpaceCore(session, peerPseudo, peerUserId);
  await addJoinedSpace(session.spacesRegistryClient, session.userId, dmSpaceRecord(ref.spaceId, peerPseudo));
  return ref;
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
    if (isDmSpaceId(s.id)) continue;
    try {
      const { owner, members } = await readSpaceAccess(session.accountClient, s.id);
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
  const { dms } = await readSpaces(session.spacesRegistryClient, session.userId);
  const existing = dms[peerUserId];
  if (existing) return { spaceId: existing, roomId: dmRoomId(existing) };

  const ref = await createDmSpace(session, peerPseudo, peerUserId);
  // Reuse the whole space-invite flow (keyring recipient + roster + member cap). It
  // builds the same SpaceInvite JSON acceptSpaceInvite consumes, reading the space name
  // we just stored for the bundle.
  const requestJson = JSON.stringify({ edPub: peerKeys.edPub, kemPub: peerKeys.kemPub, userId: peerUserId, kemSig: peerKeys.kemSig });
  const inviteJson = await inviteToSpace(session, ref.spaceId, requestJson, true);
  await setDmMapping(session.spacesRegistryClient, session.userId, peerUserId, ref.spaceId);
  // Deliver: seal the invite to the peer and append it to the shared space's carrier.
  const client = getSpaceClient(sharedSpaceId, session);
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
      const { owner, members } = await readSpaceAccess(session.accountClient, s.id);
      // Owner is the creator; members holds the other side. The peer is whichever
      // roster entry isn't us (works from both the creator's and the invitee's view).
      const peer = [owner ?? '', ...members].find((u) => u && u !== session.userId);
      if (!peer || healed[peer]) continue; // unknown peer, or peer already mapped — skip
      healed[peer] = s.id;
      void setDmMapping(session.spacesRegistryClient, session.userId, peer, s.id).catch(() => {});
    } catch {
      /* unreadable dm space — skip, try again next refresh */
    }
  }
  return healed;
}

/**
 * Self-heal DM access rosters: ensure every DM space THIS session owns lists its peer in
 * `_access.members`. The /events SSE proxy + FCM bridge authorize a space purely from
 * `_access.{owner,members}` (strict no-TOFU enricher; caps are ignored), so a DM whose peer
 * never landed in the roster delivers message READS (cap-gated) but NO live notifications or
 * unread. New DMs seed the roster at creation ({@link createDmSpaceCore}); this repairs DMs
 * created before that seeding.
 *
 * `addSpaceMember` is idempotent and self-skips when the peer is the space OWNER (adding the
 * owner as a member no-ops), and only the owner may write `_access` — so this heals only the
 * DMs WE own and leaves peer-owned DMs for the peer's own heal pass. Once both sides run it,
 * every DM is covered. Best-effort per DM, never throws. `dms` is the peer→space map — the
 * only source of the peer id for a DM whose roster is still empty.
 */
export async function healDmRosters(session: Session, dms: DmMap): Promise<void> {
  for (const [peerUserId, spaceId] of Object.entries(dms)) {
    if (!isDmSpaceId(spaceId)) continue;
    await addSpaceMember(session.contentClient, spaceId, session.userId, peerUserId).catch(() => {});
  }
}

/**
 * Accept a batch of scanned invites: resolve each DM space's authoritative owner as
 * the peer, apply the {@link dmWinner} rule against any space WE created for that
 * peer, and accept + persist the mapping. Mutates `dms`/`accepted` in place so a
 * later invite in the same reconcile run dedups. Returns true if any mapping
 * changed. Best-effort per invite, never throws. The shared accept half of
 * {@link reconcileDmInbox} — identical for carrier and DM-link inbox invites.
 */
async function acceptScannedInvites(
  session: Session,
  invites: { inviteJson: string; spaceId: string }[],
  dms: DmMap,
  accepted: Set<string>,
): Promise<boolean> {
  let changed = false;
  for (const inv of invites) {
    // The DM space's authoritative owner (the peer who invited us) — server-gated, so
    // it can't be forged. We're already in its roster (the inviter added us), so we
    // can read it before fully accepting.
    let peerUserId: string | null;
    try {
      peerUserId = (await readSpaceAccess(session.accountClient, inv.spaceId)).owner;
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
      await setDmMapping(session.spacesRegistryClient, session.userId, peerUserId, inv.spaceId);
      dms[peerUserId] = inv.spaceId; // reflect locally so a later invite in this run dedups
      accepted.add(inv.spaceId);
      changed = true;
    }
  }
  return changed;
}

/**
 * Scan every DM-invite delivery channel — the carriers in every shared private space
 * AND this identity's own personal DM inbox (where "DM me" link openers deliver, see
 * dm-link.ts) — accept new invites (verifying the cap binds to this identity), and
 * record peer→space mappings, applying the {@link dmWinner} rule when we ALSO
 * created our own space for that peer. Returns true if any mapping changed (so the
 * caller can refresh the DM list).
 *
 * Best-effort throughout: an unreadable space, a poisoned carrier element, or a single
 * un-acceptable invite is skipped, never fatal.
 */
export async function reconcileDmInbox(session: Session, knownSpaces: Space[]): Promise<boolean> {
  const { dms, caps } = await readSpaces(session.spacesRegistryClient, session.userId);
  // Skip invites for spaces we've already joined (mapped, or holding a member cap).
  const accepted = new Set<string>([...Object.values(dms), ...Object.keys(caps)]);
  let changed = false;
  for (const s of knownSpaces) {
    if (isDmSpaceId(s.id)) continue;
    let client: StarfishClient;
    try {
      client = getSpaceClient(s.id, session);
    } catch {
      continue; // can't open this shared space's client — skip its carrier
    }
    const invites = await scanDmInbox(session, client, s.id, accepted).catch(() => []);
    if (await acceptScannedInvites(session, invites, dms, accepted)) changed = true;
  }
  // The personal DM inbox (every identity implicitly has one — "DM me" link
  // deliveries land here). Same sealed bundles, same accept path as a carrier.
  const invites = await scanDmLinkInbox(session, accepted).catch(() => []);
  if (await acceptScannedInvites(session, invites, dms, accepted)) changed = true;
  return changed;
}
