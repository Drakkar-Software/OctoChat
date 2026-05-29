/**
 * Resolve a tapped notification's `{ spaceId, roomId }` payload to a real room and
 * navigate to it. The push carries only ids (chat is E2EE — no name/kind on the
 * wire), so a bare `router.push({ id })` opened the room screen with `name = id`
 * (the AppBar title became the raw `sp-<rand>-<name>` id) and `kind = 'channel'`
 * (a stream room then loaded from the wrong storage path and came up empty).
 *
 * Here we look the room up in the already-synced rooms registry to recover its real
 * `name` + `kind`, and set the active space so the rooms tab / back-navigation land
 * on the notification's space. Payload-shape tolerant: works given either id, and
 * still opens by id if the registry can't resolve it (the old behavior, as a floor).
 */
import { router } from 'expo-router';

import type { RoomsRegistryEntry } from '../rooms-registry-context';
import { spaceIdFromRoomId } from '../starfish/paths';

export interface OpenRoomFromPushDeps {
  /** Read a space's rooms registry (shared cache); see RoomsRegistryActions.ensure. */
  ensure: (spaceId: string) => Promise<RoomsRegistryEntry>;
  /** Focus a space (rooms tab + back target). */
  setActiveId: (spaceId: string) => void;
}

export async function openRoomFromPush(
  data: { spaceId?: string; roomId?: string; docId?: string },
  deps: OpenRoomFromPushDeps,
): Promise<void> {
  // Public-space rooms carry the room id as `docId`; accept either (see PushData).
  const roomId = data.roomId || data.docId || undefined;
  const spaceId = data.spaceId || (roomId ? spaceIdFromRoomId(roomId) : undefined);
  if (!spaceId && !roomId) return;

  if (spaceId) deps.setActiveId(spaceId); // focus the right space before routing

  // Only the space is known (e.g. a public-channel push carries no roomId): land on
  // the rooms tab, now focused on that space, rather than nowhere.
  if (!roomId) {
    router.navigate('/(tabs)/rooms');
    return;
  }

  const entry = spaceId ? await deps.ensure(spaceId).catch(() => null) : null;
  const room = entry?.rooms.find((r) => r.id === roomId);
  router.push({
    pathname: '/room/[id]',
    // Resolved → real name/kind (correct title + stream rooms via useStreamRoom).
    // Unresolved → still open by id (degrades to the prior behavior, never worse).
    params: room ? { id: room.id, name: room.name, kind: room.kind } : { id: roomId },
  });
}
