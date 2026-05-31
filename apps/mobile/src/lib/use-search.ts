import { useEffect, useMemo, useState } from 'react';

import { loadAllMessages, type CrossRoomMessage } from './cross-room';
import { useSession } from './session-context';

/**
 * Full-text search across the rooms of a space. The space corpus is pulled +
 * decrypted ONCE per `(session, spaceId)`; typing only re-filters that in-memory
 * list, so each keystroke costs no network/decrypt work.
 */
export function useSearch(query: string, spaceId: string | null) {
  const { session } = useSession();
  const [corpus, setCorpus] = useState<CrossRoomMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!session || !spaceId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: clear corpus when signed out / no space
      setCorpus([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const all = await loadAllMessages(session, spaceId);
        if (!cancelled) setCorpus(all);
      } catch {
        if (!cancelled) setCorpus([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, spaceId]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return corpus
      .filter((x) => (x.msg.text ?? '').toLowerCase().includes(q))
      .sort((a, b) => b.msg.ts - a.msg.ts);
  }, [corpus, query]);

  return { results, loading };
}
