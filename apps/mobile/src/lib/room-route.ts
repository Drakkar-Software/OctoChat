/**
 * Pure room-routing helpers shared by the room screen ({@link ./../app/room/[id]}) and the
 * room hook ({@link ./use-room}). Extracted so the tricky bits — which log collection a room's
 * messages live in, and how a ticket's space/access is recovered — are unit-testable without
 * rendering a hook or a route.
 *
 * The subtle invariant they encode: a ticket is an `access:'invite'` node whose id is
 * `ticket-<hex>` — it carries NO space segment, and it lives OUTSIDE the rooms registry. So
 * the space id and access tier must be threaded in explicitly (from nav params), and the
 * message log must be addressed with that explicit space id via `objInvLog*(spaceId, roomId)`
 * — never `streamInvRoom*(roomId)`, which would re-derive the space from the room id and land
 * on the wrong path for a ticket.
 */
import type { NodeAccess } from '@drakkar.software/octochat-sdk';
import {
  objInvLogPull,
  objInvLogPush,
  spaceIdFromRoomId,
  streamPubRoomPull,
  streamPubRoomPush,
  streamRoomPull,
  streamRoomPush,
} from '@drakkar.software/octochat-sdk';

export interface RoomLogPaths {
  pull: string;
  push: string;
}

/**
 * The pull/push paths for a room's message log, by access tier:
 *  - `public`  → `streamPubRoom*` (anonymous read / member write)
 *  - `invite`  → `objInvLog*(spaceId, roomId)` (cap-gated objinvlog; plaintext AND E2EE tickets)
 *  - default   → `streamRoom*` (space-tier objlog)
 *
 * `invite` MUST pass `spaceId` explicitly: `streamInvRoom*(roomId)` derives the space from the
 * room id, which is wrong for `ticket-<hex>` ids (no embedded space). `enc` does not change the
 * path — an E2EE ticket's bytes are sealed by the per-node keyring but still live in objinvlog.
 */
export function resolveRoomLogPaths(
  access: NodeAccess | undefined,
  spaceId: string,
  roomId: string,
): RoomLogPaths {
  if (access === 'public') return { pull: streamPubRoomPull(roomId), push: streamPubRoomPush(roomId) };
  if (access === 'invite') return { pull: objInvLogPull(spaceId, roomId), push: objInvLogPush(spaceId, roomId) };
  return { pull: streamRoomPull(roomId), push: streamRoomPush(roomId) };
}

/**
 * The space a room belongs to. A nav param wins (the ticket list passes it, since a
 * `ticket-<hex>` id has no embedded space); otherwise derive it from a `sp-<rand>-<name>`
 * room id, which does embed it.
 */
export function resolveRoomSpaceId(params: { spaceId?: string }, roomId: string): string {
  return params.spaceId ?? spaceIdFromRoomId(roomId);
}

/**
 * A room's `{ access, enc }`. Normal rooms resolve from the rooms registry (`registryRoom`);
 * tickets live outside it, so the ticket list passes `access`/`enc` as nav params — used as the
 * fallback. `enc` is a string param: `'1'` → true, `'0'` → false, absent → undefined (defer to
 * the registry once it settles).
 */
export function resolveRoomAccess(
  params: { access?: string; enc?: string },
  registryRoom: { access?: NodeAccess; enc?: boolean } | null,
): { access: NodeAccess | undefined; enc: boolean | undefined } {
  return {
    access: registryRoom?.access ?? (params.access as NodeAccess | undefined),
    enc:
      registryRoom?.enc ??
      (params.enc === '1' ? true : params.enc === '0' ? false : undefined),
  };
}
