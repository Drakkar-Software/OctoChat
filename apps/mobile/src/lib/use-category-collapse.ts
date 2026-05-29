/**
 * Per-space, per-identity collapse state for channel categories. Categories are
 * **collapsed by default** (a name absent from the stored map reads as collapsed);
 * expanding one persists so it stays open across reloads. Storage goes through the
 * cross-platform `kv` layer (localStorage on web, AsyncStorage on native), keyed per
 * identity + space so two accounts / two spaces never share collapse state — the same
 * hydrate-then-persist shape as {@link useDraft}.
 *
 * The stored value is a map of **expanded** category names → true. The consumer
 * additionally force-expands the category holding the active room (see the sidebar),
 * so an open channel is never hidden behind a collapsed header.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { kvGet, kvSet } from './starfish/kv';

const collapseKey = (userId: string, spaceId: string) => `octochat.cat-collapse.${userId}.${spaceId}`;

export function useCategoryCollapse(userId: string | undefined, spaceId: string | null) {
  const storageKey = userId && spaceId ? collapseKey(userId, spaceId) : undefined;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // The key whose stored value we've loaded — gates the persist effect so the
  // pre-hydration empty map never clobbers a stored one (mirrors useDraft).
  const hydratedKey = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!storageKey) {
      hydratedKey.current = undefined;
      return;
    }
    let cancelled = false;
    void kvGet(storageKey).then((stored) => {
      if (cancelled) return;
      hydratedKey.current = storageKey;
      let next: Record<string, boolean> = {};
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed === 'object') next = parsed as Record<string, boolean>;
        } catch {
          /* corrupt value → default collapsed */
        }
      }
      setExpanded(next);
    });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || hydratedKey.current !== storageKey) return;
    void kvSet(storageKey, JSON.stringify(expanded));
  }, [expanded, storageKey]);

  const isExpanded = useCallback((name: string) => !!expanded[name], [expanded]);
  const toggle = useCallback(
    (name: string) => setExpanded((m) => ({ ...m, [name]: !m[name] })),
    [],
  );

  return { isExpanded, toggle };
}
