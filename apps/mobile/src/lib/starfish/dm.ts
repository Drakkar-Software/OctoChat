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

import type { Room, Space } from '@/lib/types';

import { ensureRoomInitialized, ownerEnsureKeyring } from './client';
import { acceptSpaceInvite, inviteToSpace } from './members';
import { isPublicSpaceId } from './pubspace';
import { appendDmInvite, scanDmInbox } from './dm-inbox';
import type { PeerKeys } from './dm-keys';
import { ownerTrustedAdders, type Session } from './identity';
import { addJoinedSpace, DEFAULT_CATEGORY, readRooms, readSpaces, setDmMapping, writeRooms } from './registry';
import { getSpaceEncryptor } from './space-encryptor';

import { randomId } from '../ids';

/** A DM space id — random + `dm-`-prefixed (a TYPE tag, not a deterministic identity:
 *  still CSPRNG-unguessable, so the first-writer-owns TOFU rule can't be exploited). */
function newDmSpaceId(): string {
  return `dm-${randomId()}`;
}

/** True for a DM space (vs a normal `sp-` space or a `psp-` public space). The room
 *  list uses this to keep DMs out of the space rail. */
export const isDmSpaceId = (spaceId: string): boolean => spaceId.startsWith('dm-');

/** The single room of a DM space. `spaceIdFromRoomId('dm-x-dm')` → `dm-x` (round-trips
 *  through the first-two-segments rule, like every room id). */
export const dmRoomId = (spaceId: string): string => `${spaceId}-dm`;

export interface DmRef {
  spaceId: string;
  roomId: string;
}

/**
 * Decide which of two competing DM spaces survives when A and B create one each before
 * either's invite arrives: the space owned by `min(userId)` wins (a stable, symmetric
 * rule both sides compute identically). `mySpaceId` is our own-created space (owned by
 * us) for this peer, if any; `peerSpaceId` is the one we just received an invite for
 * (owned by the peer). Returns the winning space id.
 */
export function dmWinner(
  myUserId: string,
  peerUserId: string,
  mySpaceId: string | undefined,
  peerSpaceId: string,
): string {
  if (!mySpaceId || mySpaceId === peerSpaceId) return peerSpaceId; // no competition
  return myUserId < peerUserId ? mySpaceId : peerSpaceId;
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
  // Claim ownership (TOFU first write) + register the one DM room. Members start empty;
  // inviteToSpace adds the peer to the roster.
  const room: Room = { id: roomId, spaceId, category: DEFAULT_CATEGORY, name: peerPseudo, kind: 'dm' };
  await writeRooms(session.chatClient, spaceId, [room], session.userId, [], null, { name: peerPseudo });
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
