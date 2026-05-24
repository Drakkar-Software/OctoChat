import { useEffect, useState } from 'react';

import { loadAllMessages, type CrossRoomMessage } from './cross-room';
import { useSession } from './session-context';

/** Full-text search across the decrypted rooms of a space. */
export function useSearch(query: string, spaceId: string | null) {
  const { session } = useSession();
  const [results, setResults] = useState<CrossRoomMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim().toLowerCase();
    if (!session || !spaceId || q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: clear results when the query/space falls below the search threshold
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const all = await loadAllMessages(session, spaceId);
        const hits = all
          .filter((x) => (x.msg.text ?? '').toLowerCase().includes(q))
          .sort((a, b) => b.msg.ts - a.msg.ts);
        if (!cancelled) setResults(hits);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, spaceId, query]);

  return { results, loading };
}
