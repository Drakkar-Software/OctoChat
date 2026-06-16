/**
 * Per-space, per-identity collapse state for channel categories. Categories are
 * **expanded by default** (a name absent from the stored map reads as expanded);
 * collapsing one persists so it stays folded across reloads. Storage goes through the
 * cross-platform `kv` layer (localStorage on web, AsyncStorage on native), keyed per
 * identity + space so two accounts / two spaces never share collapse state — the same
 * hydrate-then-persist shape as {@link useDraft}.
 *
 * The stored value is a map of **collapsed** category names → true. The consumer
 * additionally force-expands the category holding the active room (see the sidebar),
 * so an open channel is never hidden behind a collapsed header.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { kvGet, kvSet } from '@drakkar.software/octochat-sdk';

// `.v2`: the stored map flipped meaning (was expanded-names, now collapsed-names) when
// the default became expanded — a fresh key avoids reinterpreting old maps backwards.
// `scope` namespaces independent collapse maps (e.g. 'cat' for categories, 'tickets'
// for the magic Tickets shelf) so they never clobber each other.
const collapseKey = (userId: string, spaceId: string, scope: string) =>
  `octochat.${scope}-collapse.v2.${userId}.${spaceId}`;

export function useCategoryCollapse(userId: string | undefined, spaceId: string | null, scope = 'cat') {
  const storageKey = userId && spaceId ? collapseKey(userId, spaceId, scope) : undefined;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
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
          /* corrupt value → default expanded */
        }
      }
      setCollapsed(next);
    });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || hydratedKey.current !== storageKey) return;
    void kvSet(storageKey, JSON.stringify(collapsed));
  }, [collapsed, storageKey]);

  const isCollapsed = useCallback((name: string) => !!collapsed[name], [collapsed]);
  const toggle = useCallback(
    (name: string) => setCollapsed((m) => ({ ...m, [name]: !m[name] })),
    [],
  );

  return { isCollapsed, toggle };
}
