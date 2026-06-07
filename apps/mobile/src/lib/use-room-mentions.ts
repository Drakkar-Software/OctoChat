import { useCallback, useMemo } from 'react';

import type { Room } from '@drakkar.software/octochat-sdk';

import { useRooms } from './use-rooms';

/**
 * Resolver that maps a `#channel` mention name to its {@link Room} within a
 * space, so rendered mentions can link to the right room. Returns `undefined`
 * for unknown names (the caller then renders the mention as plain text).
 */
export function useRoomMentions(spaceId: string | null): (name: string) => Room | undefined {
  const { rooms } = useRooms(spaceId);
  const byName = useMemo(() => {
    const map = new Map<string, Room>();
    for (const r of rooms) map.set(r.name.toLowerCase(), r);
    return map;
  }, [rooms]);
  return useCallback((name: string) => byName.get(name.toLowerCase()), [byName]);
}
