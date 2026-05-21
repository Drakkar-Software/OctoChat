import { useCallback, useEffect, useState } from 'react';

import { readRooms, readSpaces, writeSpaces } from './starfish/registry';
import { useSession } from './session-context';

/**
 * Space info + owner-gated settings for the space screen. Ownership is the
 * authoritative `owner` recorded in the room registry (see registry.ts /
 * space-role.ts); a legacy space with no recorded owner is treated as the
 * viewer's own (it lives in their identity-bound `_spaces`).
 */
export function useSpaceSettings(spaceId: string) {
  const { session } = useSession();
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (!session) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const { owner } = await readRooms(session.accountClient, spaceId);
        if (!cancelled) setOwnerId(owner);
      } catch {
        /* leave null */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, spaceId]);

  const isOwner = !!session && (ownerId === null || ownerId === session.userId);

  const rename = useCallback(
    async (name: string) => {
      if (!session) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      const { spaces, hash } = await readSpaces(session.accountClient, session.userId);
      const next = spaces.map((s) =>
        s.id === spaceId ? { ...s, name: trimmed, short: trimmed.slice(0, 2).toUpperCase() } : s,
      );
      await writeSpaces(session.accountClient, session.userId, next, hash);
    },
    [session, spaceId],
  );

  return { ownerId, isOwner, loading, rename };
}
