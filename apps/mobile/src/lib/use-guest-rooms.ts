/**
 * Requester-side "guest rooms" hook — shared rooms and tickets that the signed-in user
 * was granted access to as a NON-MEMBER (via the resource-request / request-link flow).
 *
 * These are the synthetic `Space` records (`shared-<hex>` or `ticket-<hex>`) injected
 * by {@link claimGrantedNodes} into `_spaces.spaces` after the owner accepts a request.
 * They live in `guestSpaces` (filtered out of the rail) in {@link SpacesContextValue}.
 *
 * To open a guest room the caller needs the OWNER's real space id (where the objinvlog
 * stream lives), not the synthetic space id.  We recover it by scanning the per-node
 * access store: every accepted grant writes a `${ownerSpaceId}:${nodeId}` entry, so a
 * suffix-search for `:${nodeId}` yields the owner's space.
 */
import { useMemo } from 'react';

import { isSharedRoomId, isTicketRoomId, localSpaceAccessEntries } from '@drakkar.software/octochat-sdk';
import { useSpacesContext } from './spaces-context';
import { useUnreadCounts } from './unread-context';

export interface GuestRoomEntry {
  /** The node id: `shared-<hex>` for shared rooms, `ticket-<hex>` for tickets. */
  nodeId: string;
  /** Display name from the synthetic Space record (set at claim time from `nodeName`). */
  name: string;
  /** The owner's real space id — pass as `spaceId` when opening the room so
   *  {@link resolveRoomLogPaths} routes to the correct `objInvLog` stream. */
  ownerSpaceId: string;
  /** True for support tickets (`ticket-<hex>`), false for shared rooms (`shared-<hex>`). */
  isTicket: boolean;
  /** True when a per-node keyring entry exists for this node (E2EE room/ticket). */
  enc: boolean;
  /** Unread message count for this node's objinvlog stream. */
  unread: number;
}

/**
 * Scan the local per-node access store and return the owner's real space id for `nodeId`.
 * Keys are formatted as `${ownerSpaceId}:${nodeId}`.  Returns null when no entry exists
 * (the access store isn't yet hydrated, or the grant was never accepted).
 */
function ownerSpaceIdForNode(nodeId: string): string | null {
  const suffix = `:${nodeId}`;
  for (const key of Object.keys(localSpaceAccessEntries())) {
    if (key.endsWith(suffix)) return key.slice(0, key.length - suffix.length);
  }
  return null;
}

/**
 * True when the node has a per-node keyring entry — i.e. the room/ticket is E2EE.
 * The keyring key format is `${ownerSpaceId}:${nodeId}:keyring`.
 */
function isNodeEncrypted(ownerSpaceId: string, nodeId: string): boolean {
  return `${ownerSpaceId}:${nodeId}:keyring` in localSpaceAccessEntries();
}

/**
 * REQUESTER: list all shared rooms and tickets the user was granted access to without
 * being a space member.  Entries are sorted by name (stable across reloads).
 *
 * Opens correctly via `router.push('/room/[id]', { id: entry.nodeId, spaceId:
 * entry.ownerSpaceId, access: 'invite', enc: '0', kind: 'channel' })`.
 */
export function useGuestRooms(): GuestRoomEntry[] {
  const { guestSpaces } = useSpacesContext();
  const { unreadByRoom } = useUnreadCounts();

  return useMemo(() => {
    return guestSpaces
      .map((s): GuestRoomEntry | null => {
        if (!isSharedRoomId(s.id) && !isTicketRoomId(s.id)) return null;
        const ownerSpaceId = ownerSpaceIdForNode(s.id);
        if (!ownerSpaceId) return null;
        return {
          nodeId: s.id,
          name: s.name || s.id,
          ownerSpaceId,
          isTicket: isTicketRoomId(s.id),
          enc: isNodeEncrypted(ownerSpaceId, s.id),
          unread: unreadByRoom[s.id] ?? 0,
        };
      })
      .filter((e): e is GuestRoomEntry => e !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestSpaces, unreadByRoom]);
}
