import { useEffect, useState } from 'react';

import { loadAllMessages, type CrossRoomMessage } from './cross-room';
import { useSession } from './session-context';

/** Recent activity across a space's rooms (newest first). */
export function useActivity(spaceId: string | null) {
  const { session } = useSession();
  const [items, setItems] = useState<CrossRoomMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!session || !spaceId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const all = await loadAllMessages(session, spaceId);
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
