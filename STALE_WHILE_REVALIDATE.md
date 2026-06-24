# Stale-while-revalidate plan for starfish-client

## Background

OctoChat's first-boot latency was diagnosed against `starfish-client 3.0.0-alpha.31`.
This document records the exact current behaviour of the SWR layer and the precise
changes needed in starfish-client to complete the picture. The OctoChat-side boot-gate
fix (change #1 in the OctoChat PR) already eliminates the dominant bottleneck by
making `hydrateCapsFor` non-blocking; the gaps below address the remaining latency
sources that live inside the library itself.

---

## What already works (do not regress)

**`useMergeDoc`-backed stores (object index, room docs) already implement SWR correctly.**

`acquireSyncStore` / `useSyncInit` (`bindings/zustand.js`) call:

```js
store.getState().seed().finally(() => {
  store.getState().pull().catch(() => {});
});
```

`seed()` reads the kv pull-cache via `SyncManager.seedFromCache()` →
`client.peekCache(path)` (pure kv, no network) and paints `{ data, stale: true }`
into the zustand store. `pull()` then runs in the background inside `.finally()`.
The store is returned to the caller immediately — the UI paints from cache with zero
network wait, and the fresh data arrives asynchronously.

The pull-cache is kv-backed (`octospaces.pullcache.<path>` key, 30-day TTL enforced
in `readCache()` by `Date.now() - parsed.cachedAt > cacheMaxAgeMs`). It is also
written on every successful `push()`, so local writes keep the cache warm.

**The `stale` flag** is set to `true` by `seed()` and reset to `false` after a
successful live `pull()` (or kept `true` when a 429/5xx cache-fallback serves the
result). No OctoChat consumer reads `stale` today — but it is available for any
loading-indicator optimisation.

---

## Gap A — `StarfishClient.pull()` is strictly network-first (no cache-first option)

**Current behaviour** (`index.js`, `pull()` method, lines ~451–535):

```
1. Build URL + auth headers
2. await this.fetch(url)           ← always fires network
3. On network throw: readCache() → serve stale or re-throw
4. On !res.ok + cacheFallbackStatuses (429/500/502/503/504): scheduleRevalidate() + readCache()
5. On 2xx: write to cache, return
```

`peekCache()` exists (`index.js`) with the JSDoc comment "the basis for cache-first
paint", but `pull()` never calls it for the online case. **There is no path in
`pull()` that serves the cache and fires the network in the background when
connectivity is good.**

**What to add:**

A `staleWhileRevalidate?: boolean` option on `StarfishClient.pull()` (and the
corresponding `SyncManager.pull()` + zustand `pull()` action):

```ts
async pull(pathAndQuery: string, opts?: { staleWhileRevalidate?: boolean }): Promise<PullResult>
```

When `staleWhileRevalidate: true`:
1. Read cache via `peekCache()` synchronously.
2. If a cache hit exists, return it immediately with a `stale: true` tag.
3. Kick the actual `fetch()` in the background; on success write to cache AND call
   `this.onRevalidated?.(path, freshResult)` so the caller can update its store.
4. If no cache hit, fall through to the existing network-first path (blocking).

This lets the `readSpaces()` call in `starfish-spaces` (and any other direct
`client.pull()` caller) opt into true SWR without needing a full zustand store.

---

## Gap B — `onRevalidated` doesn't push fresh data back into the zustand store

**Current behaviour** (`revalidateLoop`, `index.js` lines ~551–592):

After a 429/5xx cache-fallback, `revalidateLoop()` retries up to 5 times with
exponential backoff. On a successful retry it:
1. Writes the fresh snapshot to the pull-cache.
2. Calls `this.onRevalidated?.(pathAndQuery, result)`.

In OctoChat, `onRevalidated` is wired as:
```js
onRevalidated: () => reportReachability(true)   // use-merge-doc.ts:95
```

It marks the app back online but **does not call `store.getState().pull()`**. The
fresh data written to cache never reaches the zustand store state. The UI stays on
the stale 429-fallback snapshot until the next navigation or store re-acquisition.

**What to change:**

Pass the fresh `PullResult` to `onRevalidated`:

```ts
onRevalidated?: (pathAndQuery: string, result: PullResult) => void
```

In `use-merge-doc.ts` (OctoChat consumer), update the handler to push the fresh
result directly into the store:

```ts
onRevalidated: (_, result) => {
  reportReachability(true);
  // Merge the fresh snapshot — same logic as a successful pull()
  store.getState().mergeResult(result);
}
```

`mergeResult` (or equivalent) should be a new action that applies a `PullResult` to
the store state without firing a new network request.

---

## Gap C — `readSpaces()` bypasses SWR entirely

**Current behaviour** (`starfish-spaces/dist/index.js`, `readSpaces` / `pullSpacesDoc`):

```js
// Inside pullSpacesDoc():
return client.pull(session.layout.spacesPull(userId));
```

This is a bare `StarfishClient.pull()` call — always network-first. There is no
`seed()`, no zustand store, no cache-first read. The `_spaces` doc carries the full
space list + caps + mutes + reads + quick-reactions + archived-DMs, so this one
network call dominates every boot (it was the primary gate before the OctoChat
change #1 fix decoupled it from `setStatus('ready')`).

**What to add (after Gap A is implemented):**

Use `pull({ staleWhileRevalidate: true })` inside `pullSpacesDoc()`:

```ts
async function pullSpacesDoc(client, userId) {
  const result = await client.pull(layout.spacesPull(userId), {
    staleWhileRevalidate: true,
  });
  // `result.stale` is true when served from cache; the background revalidation
  // will call onRevalidated with the fresh doc when it arrives.
  return coerceSpacesDoc(result.data);
}
```

This means `readSpaces()` returns the cached `_spaces` doc instantly on every boot
(while the network revalidates in the background), eliminating the last network-gated
latency in the `hydrateCapsFor` path even when the OctoChat app does not defer it.

---

## Gap D — `syncing: true` flashes while stale data is visible (cosmetic)

When `seed()` has already painted stale data into the store, the subsequent `pull()`
action sets `syncing: true` immediately (zustand.js line ~1204). This causes a brief
visual transition from "stale but painted" to "spinner" before settling on fresh data.

**What to change:** When the store already shows stale data (`get().stale === true`),
suppress the `syncing` flag during `pull()` — the user sees the stale content as
authoritative and a spinner would be confusing. Only show `syncing` when the store is
freshly empty (no seed data yet).

---

## Implementation order

1. **Gap A** — `pull({ staleWhileRevalidate })` option. This is the load-bearing
   change; B and C depend on it.
2. **Gap B** — pass `PullResult` to `onRevalidated`; update OctoChat's `use-merge-doc`
   handler. Fixes the "stays stale after rate-limit" regression.
3. **Gap C** — opt `readSpaces()` into SWR via the new option in `starfish-spaces`.
4. **Gap D** — suppress `syncing` spinner when stale data is visible (cosmetic;
   low priority).

---

## Affected files

| Package | File | Change |
|---|---|---|
| `starfish-client` | `src/client.ts` | Add `staleWhileRevalidate` option to `pull()`; serve cache immediately + revalidate in background |
| `starfish-client` | `src/sync.ts` | Propagate option through `SyncManager.pull()` |
| `starfish-client` | `src/client.ts` | Pass `PullResult` to `onRevalidated` callback (Gap B) |
| `starfish-client` | `src/bindings/zustand.ts` | Propagate to zustand `pull()` action; suppress `syncing` on stale (Gap D) |
| `starfish-client` | `src/bindings/zustand.ts` | Add `mergeResult(result)` action (Gap B) |
| `starfish-spaces` | `src/spaces.ts` | Use `pull({ staleWhileRevalidate: true })` in `pullSpacesDoc()` (Gap C) |
| `octochat` (consumer) | `apps/mobile/src/lib/use-merge-doc.ts` | Update `onRevalidated` to call `mergeResult` (Gap B) |

---

## Correctness notes

- Cache-first reads must still enforce the 30-day TTL. `peekCache()` already does
  this — reuse it, do not bypass `cacheMaxAgeMs`.
- The background revalidation triggered by Gap A's new path must deduplicate with any
  existing `revalidateLoop()` for the same key (the existing `scheduleRevalidate`
  deduplication logic should cover this).
- `readSpaces()` returns a plain object, not a zustand store — so Gap C's SWR is
  callback-based: the caller (OctoChat's `hydrateCapsFor`) passes an `onFreshData`
  callback to handle the background update. `hydrateCapsFor` can apply the fresh doc
  to re-run `primeSpaces`, `hydrateMutes`, `hydrateReads`, etc. without blocking first
  paint. Alternatively, `readSpaces` can be split into `readSpacesCached()` (instant)
  + `readSpacesLive()` (network) if a callback API is undesirable.
