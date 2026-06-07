/**
 * Public-space directory hook.
 *
 * Loads the server-maintained public-space index (see {@link loadPublicSpaceIndex})
 * once on mount and resolves each space owner's display pseudo via the public
 * `profile` collection ({@link readProfiles}). The Explore screen consumes this;
 * all data access stays here, none in the route (design rule 3/4).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { loadPublicSpaceIndex, type PublicSpaceEntry } from '@drakkar.software/octochat-sdk';
import { readProfiles } from '@drakkar.software/octochat-sdk';

export interface ExploreSpacesState {
  /** Listed public spaces, newest write first. */
  spaces: PublicSpaceEntry[];
  /** Owner userId → display pseudo (absent until resolved; falls back in the UI). */
  ownerNames: Map<string, string>;
  /** True only during the initial load (and an explicit reload). */
  loading: boolean;
  /** Re-fetch the directory (the directory is a snapshot, not live). */
  reload: () => void;
}

/**
 * Read the public-space directory + owner names. Snapshot on mount; call `reload`
 * to refresh (e.g. pull-to-refresh) — the index updates server-side as public
 * spaces change, but this hook does not subscribe to live events.
 */
export function useExploreSpaces(): ExploreSpacesState {
  const [spaces, setSpaces] = useState<PublicSpaceEntry[]>([]);
  const [ownerNames, setOwnerNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  // Guards setState after unmount (the directory + profile fetches are async).
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await loadPublicSpaceIndex();
    if (!alive.current) return;
    setSpaces(list);
    setLoading(false);
    // Resolve owner pseudos in one batched round-trip; names fill in after the list
    // renders so the directory never blocks on profile reads.
    const ownerIds = [...new Set(list.map((s) => s.ownerId).filter((id): id is string => !!id))];
    if (ownerIds.length === 0) return;
    const profiles = await readProfiles(ownerIds);
    if (!alive.current) return;
    const names = new Map<string, string>();
    profiles.forEach((p, id) => {
      if (p.pseudo) names.set(id, p.pseudo);
    });
    setOwnerNames(names);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  return { spaces, ownerNames, loading, reload };
}
