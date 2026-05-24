import { useEffect, useState } from 'react';

import { readProfile } from './starfish/client';

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

function fetchProfile(userId: string): Promise<void> {
  const pending = inflight.get(userId);
  if (pending) return pending;
  const p = (async () => {
    const { pseudo, avatar } = await readProfile(userId);
    const prev = cache.get(userId) ?? {};
    // Keep prior values when a field comes back null: readProfile also returns
    // null on a network error, and a blip shouldn't wipe a known name/avatar.
    // Trade-off: a *removed* avatar therefore won't propagate to other clients
    // via fetch (only via primeProfile on the editing client) until the cache is
    // re-initialized (a web refresh). Acceptable for now.
    const next: CachedProfile = { pseudo: pseudo ?? prev.pseudo, avatar: avatar ?? prev.avatar };
    if (prev.pseudo !== next.pseudo || prev.avatar !== next.avatar) {
      cache.set(userId, next);
      notify();
    }
  })().finally(() => inflight.delete(userId));
  inflight.set(userId, p);
  return p;
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
    for (const id of key ? key.split(',') : []) void fetchProfile(id);
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
