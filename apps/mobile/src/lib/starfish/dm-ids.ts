/**
 * Pure DM id + dedup helpers — split out from `dm.ts` so they carry NO heavy imports
 * (crypto clients, expo config) and stay unit-testable in isolation.
 */
import { randomId } from '../ids';

/** A DM space id — random + `dm-`-prefixed. The prefix is a TYPE tag (so the room list
 *  can filter DMs out of the space rail), NOT a deterministic identity: it stays
 *  CSPRNG-unguessable, so the server's first-writer-owns TOFU rule can't be exploited. */
export function newDmSpaceId(): string {
  return `dm-${randomId()}`;
}

/** True for a DM space (vs a normal `sp-` space or a `psp-` public space). */
export const isDmSpaceId = (spaceId: string): boolean => spaceId.startsWith('dm-');

/** The single room of a DM space. `spaceIdFromRoomId('dm-x-dm')` → `dm-x` (round-trips
 *  through the first-two-segments rule, like every room id). */
export const dmRoomId = (spaceId: string): string => `${spaceId}-dm`;

/**
 * Decide which of two competing DM spaces survives when A and B each create one before
 * the other's invite arrives: the space owned by `min(userId)` wins (a stable,
 * symmetric rule both sides compute identically). `mySpaceId` is our own-created space
 * (owned by us) for this peer, if any; `peerSpaceId` is the one we received an invite
 * for (owned by the peer). Returns the winning space id.
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
