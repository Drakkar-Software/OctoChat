import { useEffect, useState } from 'react';

import { readProfiles } from './starfish/client';

// Public profiles (pseudo + avatar) keyed by userId, shared across every consumer
// so the same author resolved in the message stream, a thread and a search result
// all hit one cache and one fetch. Profiles are public-read, so any user's is
// resolvable; the monogram / hex prefix fills in until one arrives.
//
// CAVEAT (React Compiler): the accessors below return getters over this module
// cache, whose identity does NOT change when the cache updates. Consumers re-render
// (via the listener tick) but the compiler can memoize accessor-derived JSX as long
// as the input `ids` are stable — so a fetched profile may never reach the screen.
// Today's consumers work because their `ids` churn (the message stream ticks); a
// consumer with a *stable* id set (e.g. a fixed members list) must opt out with a
// `'use no memo'` directive. A fuller fix would key the accessor on the tick.
interface CachedProfile {
  pseudo?: string;
  avatar?: string;
}

const cache = new Map<string, CachedProfile>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

/** Drop every cached profile (on account switch — pseudos/avatars are per-identity).
 *  Notifies subscribers so mounted consumers re-fetch under the new session. */
export function clearPseudoCache(): void {
  cache.clear();
  inflight.clear();
  notify();
}

/** Seed/refresh one user's profile in the shared cache (e.g. after a local edit).
 *  Pass `avatar: null` to clear it locally. */
export function primeProfile(userId: string, profile: { pseudo?: string; avatar?: string | null }): void {
  const prev = cache.get(userId) ?? {};
  const next: CachedProfile = { ...prev };
  if (profile.pseudo !== undefined) next.pseudo = profile.pseudo;
  if (profile.avatar !== undefined) next.avatar = profile.avatar ?? undefined;
  if (prev.pseudo === next.pseudo && prev.avatar === next.avatar) return;
  cache.set(userId, next);
  notify();
}

/**
 * Fetch every still-unknown id in `userIds` in ONE batched round-trip per chunk
 * (via {@link readProfiles}), instead of a request per user. Skips ids already
 * cached or already in flight, and tracks the shared promise per-id so concurrent
 * consumers with overlapping id sets don't double-fetch.
 */
function fetchProfiles(userIds: string[]): void {
  const todo = userIds.filter((id) => !cache.has(id) && !inflight.has(id));
  if (todo.length === 0) return;
  const p = (async () => {
    const profiles = await readProfiles(todo);
    let changed = false;
    for (const id of todo) {
      const got = profiles.get(id); // undefined ⇒ this id's read failed/was unresolved
      const prev = cache.get(id) ?? {};
      // Keep prior values when a field comes back null: a removed/absent value or a
      // blip shouldn't wipe a known name/avatar. An id missing from the map (a
      // transient failure) leaves `got` undefined, so prev is preserved.
      // Trade-off: a *removed* avatar won't propagate to other clients via fetch
      // (only via primeProfile on the editing client) until the cache is
      // re-initialized (a web refresh). Acceptable for now.
      const next: CachedProfile = { pseudo: got?.pseudo ?? prev.pseudo, avatar: got?.avatar ?? prev.avatar };
      // Record an entry for every RESOLVED id — even an empty one for a user with no
      // profile doc yet — so `useProfileSync` won't re-fetch it on every id-set tick.
      // An UNRESOLVED id (absent from the map) is left uncached so a later tick retries.
      if (got !== undefined) {
        if (prev.pseudo !== next.pseudo || prev.avatar !== next.avatar) changed = true;
        cache.set(id, next);
      }
    }
    if (changed) notify();
  })().finally(() => {
    for (const id of todo) inflight.delete(id);
  });
  for (const id of todo) inflight.set(id, p);
}

/**
 * Subscribe to the shared cache and fetch any missing profiles for `userIds`.
 * Re-fetches whenever the id set changes, so a profile edited on another client
 * is picked up on the next mount (a web refresh re-inits the cache; navigating
 * back into a room re-runs this on native).
 */
function useProfileSync(userIds: string[]): void {
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
    // Batch every still-unknown id into one /batch/pull round-trip per chunk
    // (fetchProfiles skips ids already cached or in flight). This is what collapses
    // the message stream's author profiles into a few requests instead of one per
    // user. Trade-off: a profile edited on ANOTHER client won't propagate here until
    // the cache clears (account switch / web reload); our own edits do, via
    // primeProfile. Acceptable — display names/avatars are low-churn.
    fetchProfiles(key ? key.split(',') : []);
  }, [key]);
}

/** Resolve display pseudos for a set of user ids → cached pseudo or `undefined`. */
export function usePseudos(userIds: string[]): (userId: string) => string | undefined {
  useProfileSync(userIds);
  return (userId: string) => cache.get(userId)?.pseudo;
}

/** Resolve avatars (data URIs) for a set of user ids → cached avatar or `undefined`.
 *  Backed by the same cache + fetch as {@link usePseudos}, so it adds no requests. */
export function useAvatars(userIds: string[]): (userId: string) => string | undefined {
  useProfileSync(userIds);
  return (userId: string) => cache.get(userId)?.avatar;
}
