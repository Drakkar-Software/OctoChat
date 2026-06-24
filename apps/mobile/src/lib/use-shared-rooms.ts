/**
 * OWNER-side hook: shared rooms the owner created in response to inbound room requests
 * (`nodeType: 'room'` requests accepted via the Requests shelf).
 *
 * Shared rooms are ObjectNodes with `type: 'room'`, `access: 'invite'`, and a
 * `shared-<hex>` id prefix.  They live in the owner's space object index (same as
 * tickets) and are projected by this hook for the "Shared rooms" shelf.
 */
import { useCallback, useMemo } from 'react';

import { isSharedRoomId } from '@drakkar.software/octochat-sdk';
import type { ObjectNode } from '@drakkar.software/octochat-sdk';

import { useObjects } from './use-objects';
import { useUnreadCounts } from './unread-context';

export interface SharedRoomEntry {
  node: ObjectNode;
  /** Display title (node.title, non-empty; shared rooms are always plaintext). */
  title: string;
  /** Unread message count for this room. */
  unread: number;
}

/**
 * Returns all shared rooms (guest invite rooms the owner created for requesters) in a
 * space, projected from the unified object index.  An empty list hides the shelf.
 */
export function useSharedRooms(spaceId: string | null): {
  rooms: SharedRoomEntry[];
  loading: boolean;
  archive: (roomId: string) => void;
} {
  const { nodes, ready, archive: archiveNode } = useObjects(spaceId ?? '', { enabled: !!spaceId });
  const { unreadByRoom } = useUnreadCounts();

  const rooms = useMemo<SharedRoomEntry[]>(
    () =>
      nodes.flatMap((n) =>
        n.type === 'room' && n.access === 'invite' && isSharedRoomId(n.id)
          ? [{ node: n, title: n.title || 'Shared room', unread: unreadByRoom[n.id] ?? 0 }]
          : [],
      ),
    [nodes, unreadByRoom],
  );

  const archive = useCallback((roomId: string) => archiveNode(roomId), [archiveNode]);

  return { rooms, loading: !ready, archive };
}
