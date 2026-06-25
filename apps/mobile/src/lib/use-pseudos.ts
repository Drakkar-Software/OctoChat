import { useEffect, useState } from 'react';

import { readProfiles } from '@drakkar.software/octochat-sdk';

// Public profiles (pseudo + avatar) keyed by userId, shared across every consumer
// so the same author resolved in the message stream, a thread and a search result
// all hit one cache and one fetch. Profiles are public-read, so any user's is
// resolvable; the monogram / hex prefix fills in until one arrives.
//
// Reactivity model (R4 fix): each usePseudos / useAvatars call subscribes with a
// per-ids listener that computes a snapshot of ONLY the requested IDs. When a
// profile tick fires, the listener does a deep-equal check on those specific IDs
// and only calls setSnapshot when their values actually changed. This means:
//   • a component watching [user1, user2] does NOT re-render when user3's profile
//     arrives (previously: all consumers re-rendered on every profile tick)
//   • 'use no memo' opt-outs are no longer needed on any consumer
//   • React Compiler can memoize accessor-derived JSX correctly because the
//     accessor now closes over React state (snapshot) rather than a mutable Map

interface CachedProfile {
  pseudo?: string;
  avatar?: string;
}

const cache = new Map<string, CachedProfile>();
const inflight = new Map<string, Promise<void>>();
// Listeners indexed by the user-id they watch. When a profile tick fires for a
// specific id, only listeners subscribed to that id are invoked — not every
// mounted consumer (O(changed) instead of O(all mounted rows)).
const listeners = new Map<string, Set<() => void>>();

/**
 * Wake listeners for the given changed user ids. Pass no args (or `undefined`)
 * to broadcast to all listeners — used by clearPseudoCache on account switch.
 */
function notify(changedIds?: string[]) {
  let toCall: Set<() => void>;
  if (changedIds === undefined) {
    // Account switch: wake every registered listener exactly once.
    toCall = new Set();
    for (const s of listeners.values()) for (const fn of s) toCall.add(fn);
  } else {
    // Profile batch resolved: wake only listeners subscribed to a changed id.
    toCall = new Set();
    for (const id of changedIds) {
      const s = listeners.get(id);
      if (s) for (const fn of s) toCall.add(fn);
    }
  }
  for (const fn of toCall) fn();
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
  notify([userId]);
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
      const got = profiles.get(id);
      const prev = cache.get(id) ?? {};
      const next: CachedProfile = { pseudo: got?.pseudo ?? prev.pseudo, avatar: got?.avatar ?? prev.avatar };
      if (got !== undefined) {
        if (prev.pseudo !== next.pseudo || prev.avatar !== next.avatar) changed = true;
        cache.set(id, next);
      }
    }
    if (changed) notify(todo);
  })().finally(() => {
    for (const id of todo) inflight.delete(id);
  });
  for (const id of todo) inflight.set(id, p);
}

/**
 * Per-ids snapshot subscription. Registers a listener that fires only when one of
 * the requested IDs' values for `field` actually changes in the cache — not on every
 * profile tick globally. Returns a stable Map that changes reference only on a real
 * value update, so React Compiler can memoize accessor-derived JSX normally.
 */
function useProfileSnapshot(userIds: string[], field: 'pseudo' | 'avatar'): ReadonlyMap<string, string | undefined> {
  const idsKey = userIds.join(',');

  const [snapshot, setSnapshot] = useState<ReadonlyMap<string, string | undefined>>(
    () => new Map(userIds.map((id) => [id, cache.get(id)?.[field]])),
  );

  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : [];
    const update = () => {
      setSnapshot((prev) => {
        // Short-circuit: return the same reference when nothing changed for our IDs.
        // This is what prevents unrelated profile ticks from re-rendering this consumer.
        const changed = ids.some((id) => prev.get(id) !== cache.get(id)?.[field]);
        return changed ? new Map(ids.map((id) => [id, cache.get(id)?.[field]])) : prev;
      });
    };
    // Register under each watched id so notify(changedIds) only wakes us when
    // one of our ids actually changes — not when any other user's profile arrives.
    for (const id of ids) {
      let s = listeners.get(id);
      if (!s) { s = new Set(); listeners.set(id, s); }
      s.add(update);
    }
    // Sync immediately: the cache may have updated between this render and mount
    // (e.g. another component's fetch resolved in the interim).
    update();
    return () => {
      for (const id of ids) {
        const s = listeners.get(id);
        if (s) { s.delete(update); if (s.size === 0) listeners.delete(id); }
      }
    };
  }, [idsKey, field]);

  // Trigger a fetch for any IDs not yet in the cache / in-flight.
  useEffect(() => {
    fetchProfiles(idsKey ? idsKey.split(',') : []);
  }, [idsKey]);

  return snapshot;
}

/** Resolve display pseudos for a set of user ids → cached pseudo or `undefined`.
 *  Returns a stable accessor that only changes reference when one of the requested
 *  IDs' pseudo values actually updates — no 'use no memo' needed in consumers. */
export function usePseudos(userIds: string[]): (userId: string) => string | undefined {
  const snapshot = useProfileSnapshot(userIds, 'pseudo');
  return (userId: string) => snapshot.get(userId);
}

/** Resolve avatars (data URIs) for a set of user ids → cached avatar or `undefined`.
 *  Backed by the same cache + fetch as {@link usePseudos}, so it adds no requests.
 *  Returns a stable accessor that only changes reference when one of the requested
 *  IDs' avatar values actually updates — no 'use no memo' needed in consumers. */
export function useAvatars(userIds: string[]): (userId: string) => string | undefined {
  const snapshot = useProfileSnapshot(userIds, 'avatar');
  return (userId: string) => snapshot.get(userId);
}
