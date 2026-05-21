import { useEffect, useState } from 'react';

import { readPseudo } from './starfish/client';

// Display pseudos keyed by userId, shared across every consumer so the same
// author resolved in the message stream, a thread and a search result all hit
// one cache and one fetch. Profiles are public-read, so any user's pseudo is
// resolvable; `authorFor` falls back to the hex prefix until one arrives.
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

/** Seed/refresh one user's pseudo in the shared cache (e.g. after a local rename). */
export function primePseudo(userId: string, pseudo: string) {
  if (cache.get(userId) === pseudo) return;
  cache.set(userId, pseudo);
  notify();
}

function fetchPseudo(userId: string): Promise<void> {
  const pending = inflight.get(userId);
  if (pending) return pending;
  const p = (async () => {
    const pseudo = await readPseudo(userId);
    if (pseudo && cache.get(userId) !== pseudo) {
      cache.set(userId, pseudo);
      notify();
    }
  })().finally(() => inflight.delete(userId));
  inflight.set(userId, p);
  return p;
}

/**
 * Resolve display pseudos for a set of user ids. Returns a lookup that yields the
 * cached pseudo or `undefined`; misses are fetched (public profile read) and the
 * cache update re-renders every consumer. Re-fetches whenever the id set changes,
 * so a pseudo edited on another client is picked up on the next mount (e.g. a web
 * refresh, which re-inits the cache, or navigating back into a room on native).
 */
export function usePseudos(userIds: string[]): (userId: string) => string | undefined {
  const [, setTick] = useState(0);

  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  // Hex user ids never contain commas, so the joined key both stabilizes the
  // effect against fresh-array identity and round-trips back to the id list.
  const key = userIds.join(',');
  useEffect(() => {
    for (const id of key ? key.split(',') : []) void fetchPseudo(id);
  }, [key]);

  return (userId: string) => cache.get(userId);
}
