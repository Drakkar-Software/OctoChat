/**
 * Shared-room model — pure data helpers for desk "shared room" (guest invite) nodes.
 *
 * A shared room is a regular `type:'room'` node with `access:'invite'` written to the
 * desk space's object index. The owner granted an isolated non-member access to it via
 * the resource-request inbox flow — the requester reaches ONLY this node, never the space
 * index or other rooms. No space membership is required.
 * No React. No platform deps. No network calls.
 */

/** Shared-room id prefix — type-tags `shared-<hex>` ids minted by the orchestrator. */
export const SHARED_ROOM_PREFIX = 'shared-';

/**
 * True for a shared-room id (`shared-<hex>`). Like ticket ids, shared-room ids carry
 * NO embedded space segment, so `spaceIdFromRoomId` cannot derive the host space from
 * them. Callers that key off the host space must pass the space id explicitly.
 */
export function isSharedRoomId(roomId: string): boolean {
  return roomId.startsWith(SHARED_ROOM_PREFIX);
}
