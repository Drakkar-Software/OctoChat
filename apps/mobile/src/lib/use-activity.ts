import { useEffect, useState } from 'react';

import { loadAllMessages, type CrossRoomMessage } from './cross-room';
import { useSession } from './session-context';
import { readSpaces } from './starfish/registry';

/**
 * Recent activity across rooms (newest first). Pass a `spaceId` to scope to one
 * space, or `null` to span every space the identity belongs to (the desktop
 * notifications view).
 */
export function useActivity(spaceId: string | null) {
  const { session } = useSession();
  const [items, setItems] = useState<CrossRoomMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!session) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const ids = spaceId
          ? [spaceId]
          : (await readSpaces(session.accountClient, session.userId)).spaces.map((s) => s.id);
        const all = (await Promise.all(ids.map((id) => loadAllMessages(session, id)))).flat();
        const recent = all.sort((a, b) => b.msg.ts - a.msg.ts).slice(0, 40);
        if (!cancelled) setItems(recent);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, spaceId]);

  return { items, loading };
}
