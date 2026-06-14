/**
 * Public-space directory hook.
 *
 * Loads the server-maintained public-space index (both shards joined) on mount.
 * Names and images arrive directly from `loadPublicSpaceIndex` via the
 * `_index/spaces/meta` projection join — no second authenticated pass needed.
 *
 * All data access stays here, none in the route (design rule 3/4).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { loadPublicSpaceIndex, type PublicSpaceEntry } from '@drakkar.software/octochat-sdk';

export interface ExploreSpacesState {
  /** Listed public spaces, newest write first. */
  spaces: PublicSpaceEntry[];
  /** True only during the initial load (and an explicit reload). */
  loading: boolean;
  /** Re-fetch the directory (the directory is a snapshot, not live). */
  reload: () => void;
}

export function useExploreSpaces(): ExploreSpacesState {
  const [spaces, setSpaces] = useState<PublicSpaceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await loadPublicSpaceIndex();
    if (!alive.current) return;
    setSpaces(list);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const reload = useCallback(() => { void load(); }, [load]);

  return { spaces, loading, reload };
}
