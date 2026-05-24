/**
 * In-flight request dedupe. Concurrent calls keyed the same share ONE promise;
 * the entry is dropped the moment it settles, so this only collapses overlapping
 * bursts — it is NOT a result cache (a call made after the previous one settles
 * re-fetches). It exists because the registry reads (`_spaces`, `_rooms`,
 * `_keyring`, `profile`) are fired independently by several mounted consumers in
 * the same tick (desktop nav + routed page + activity feed); without this each
 * consumer hits the network separately for identical data.
 */
const inflight = new Map<string, Promise<unknown>>();

/** Share the in-flight promise for `key`; run `fn` only when none is pending. */
export function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const p = fn().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}
