# Changelog — @drakkar.software/octochat-sdk

## 0.8.1 (2026-07-06)

### Fixed

- **Sidebar thread/pin existence flags no longer fetch every room in a space.**
  `use-space-nav.ts`'s `hasThreads`/`hasPins` (desktop sidebar row visibility) folded
  EVERY room's message log on EVERY space switch, previously via a 5-worker pool and
  briefly via a batch-pull refactor that regressed to firing both the batch call AND
  every individual per-room pull against the deployed server (that batch attempt is
  fully reverted here — see `packages/sdk/src/messaging/stream-log.ts`'s history).
  Added `foldRoomFromCache` (kv-only fold, no `pull()`) and `peekNodeAccess` (sync,
  never-fetching keyring peek), plus `loadAllThreadsFromCache`/`loadAllPinsFromCache`
  in `cross-room.ts`: cache-only siblings of `loadAllThreads`/`loadAllPins` that fold
  only what's already in the local `streamlog.v2` kv cache (written by `useRoom` on
  its own, already-lazy per-room visits). A space never opened on this device shows
  both flags empty until visited once; every switch thereafter is free.
- **Threads and Pinned tabs (`useThreads`/`usePins`) have the same fix** — both
  re-fetched every room in the space via `useFocusEffect` on every screen focus.
  Now use `loadAllThreadsFromCache`/`loadAllPinsFromCache` too: opening the Threads
  or Pinned tab costs zero per-room network calls; opening an individual thread or
  pinned message from either list still fetches only that one room (`useRoom`),
  unchanged. `useSearch`'s full-text corpus load stays network-eager on purpose —
  a cache-only search would silently miss messages in any room not yet opened.

## 0.8.0 (2026-07-06)

### Changed — dk-spaces migration

- **`@drakkar.software/octospaces-sdk@0.29.1` → `@drakkar.software/dk-spaces-sdk@0.32.0`**
  (package rename + major refactor, not a drop-in bump). Same wave:
  `@drakkar.software/octospaces-platform-sdk@0.3.2` → `@drakkar.software/dk-spaces-platform-sdk@0.3.5`,
  and every `@drakkar.software/starfish-*` TS package `3.0.0-alpha.43` → `3.0.0-alpha.65`.
- **Dropped-proxy re-exports repointed directly at starfish**, per dk-spaces-sdk
  0.31.0's removal of its starfish pass-through layer: mutes/reads prefs now go
  through `createPrefsStore` (+ `mutePrefsConfig`/`readPrefsConfig` presets from
  dk-spaces-sdk); object blobs through `createSealedBlobStore` (+
  `objectBlobPaths`/`MAX_OBJECT_BLOB_BYTES`); device pairing, session builders
  (`sessionFromPersisted`/`activeAccountOf`/`rootIdentityOf`), vault/session types,
  and the object-tree/domain-type helpers now import from `starfish-spaces` /
  `starfish-client` / `starfish-protocol` instead of the old SDK proxy.
- **Wire/KV namespace renamed `octospaces` → `dk`** (deployed Starfish namespace
  and the `spaceaccess` KV-cache prefix: `octospaces.spaceaccess.*` →
  `dk.spaceaccess.*`). Set `EXPO_PUBLIC_STARFISH_NAMESPACE=dk` — this is a
  deployment-env change, not a code change.
- **`completeDevicePairing`'s root-trust check** is now mandatory (starfish
  `alpha.63`); OctoChat passes `confirmUnpinnedRoot: () => true` since a new
  device has no prior-pinned root to check against at pairing time — the PIN-sealed
  bundle + physical QR proximity remains the real security boundary.
- See `MIGRATION_CLEANUP.md` (repo root) for the temporary migration shims (KV
  prefix-rename copy, legacy pairing QR prefix acceptance) to remove once the
  rollout window has passed.

## 0.7.2 (2026-06-25)

### Fixed

- **Per-space inbox fan-out eliminated** (`desk/intake.ts`, `desk/intake-requests-cache.ts`) —
  `RequestsProvider.refresh()` previously ran a 5-worker pool calling `listPendingTicketRequests`
  once **per space**, triggering 2N inbox GETs + N `_spaces` reads per refresh. The new
  `listPendingTicketRequestsForSpaces` issues exactly **2 inbox GETs + 1 `_spaces` read** for any
  set of spaces, because `scanResourceRequests` reads the user's own inbox and filters by space in
  memory — one scan covers all. The `requests-context.tsx` provider now calls this once and groups
  the flat result by `p.req.spaceId`.

- **Module-level SWR cache** (`desk/intake-requests-cache.ts`) — `readPendingRequestsSWR` wraps
  the multi-space scan with a 2-min TTL, SWR flavor: fresh → cache hit (no network); stale →
  serve cached instantly + background revalidate → `onRevalidated(fresh)` auto-updates the UI;
  cold / space-set changed → fresh scan. `removePendingFromCache(userId, reqId)` is called on
  accept/decline so optimistic removals survive the next stale-serve. NOT request-level dedup.

- **Account-switch reset** (`session-context.tsx`) — `clearInboxRequestsCache()` added to
  `resetAccountScopedState` so no cached requests from one account bleed into the next.

## 0.7.1 (2026-06-25)

### Fixed

- **`healDmRosters` per-DM `_access` GET on the repair path** (`starfish/dm.ts`) — `healDmRosters`
  0.7.0 correctly batch-read rosters up front, but for any DM needing repair it called
  `addSpaceMember`, which internally reads `_access` again (read-modify-write). The batch snapshot
  `{ owner, members, name, image, hash }` already holds every value `addSpaceMember` would re-read,
  so the repair now issues a **direct `writeSpaceAccess` CAS write** — byte-identical to the old
  write, zero individual `_access` GETs. A DM the batch can't read is silently skipped (retried
  next refresh) rather than falling through to a per-DM read.

- **Conductor reconcile per-`sp-`-space `objects/_index` fan-out** (`apps/mobile/src/lib/automations/conductor-init.ts`)
  — the automation-task reconciler's 5-worker pool issued one individual `objects/_index` read per
  joined `sp-` space via `getSpaceClient` + `readIndexRooms`. Replaced with a single
  `batchPullManySpaceData` call over all non-DM space ids — the same plaintext, member-gated
  `objindex` the `RoomsRegistryProvider` prefetch already batches — collapsing N per-space reads
  into one (or a few) `/batch/pull?collections=spaceregistry,objindex` requests. On 429 the
  existing `try/catch` leaves tasks untouched; on non-429 / no-batch-support servers the helper
  degrades to per-space pulls internally.

## 0.7.0 (2026-06-25)

### Fixed

- **`healDmRosters` per-DM `_access` fan-out** (`starfish/dm.ts`) — `healDmRosters` now
  batch-reads all DM rosters via `batchPullManySpaceAccess` before the repair loop, so the
  common steady-state case ("peer already seeded") issues **one** `spaceregistry` batch
  request instead of N individual `_access` reads. The per-DM `addSpaceMember` write fires
  only for DMs the caller owns whose peer is genuinely absent from the roster.

- **Conductor reconcile per-DM `objects/_index` fan-out** (`apps/mobile/src/lib/automations/conductor-init.ts`)
  — the automation-task reconciler's 5-worker pool iterated the full joined-spaces list from
  `readSpaces`, which includes `dm-` spaces. DM spaces can never host automations, so their
  `objects/_index` reads were pure waste (N reads at cold load, one per DM). The pool now
  filters out DM ids (`isDmSpaceId`) before dispatching reads.

## 0.6.2 (2026-06-25)

### Added

- **Cross-space batch-pull of `_access` and `_index`** (`starfish/batch-space.ts`) — bumped
  `@drakkar.software/starfish-*` from `3.0.0-alpha.38` → `3.0.0-alpha.39` and added two new
  exported helpers that collapse N per-space round-trips into one (or a few) HTTP requests:

  - **`batchPullManySpaceData(session, spaceIds)`** — fetches `_access` + `_index` for many
    spaces in a single `/batch/pull?collections=spaceregistry,objindex` request via
    `session.spacesRegistryClient` (device cap, `paths: ["spaces/**", …]`), authorised per-entry
    by membership on the server. Chunks spaceIds into groups of ≤ 50 (server
    `max_collections_per_batch` = 100; 2 collections × 50 = 100 entries per request), issues
    chunks concurrently and merges results. On a non-429 error degrades gracefully to per-space
    `batchPullSpaceData` calls; on 429 rethrows (avoids amplifying load on a rate-limited
    server). Returns `Map<spaceId, BatchSpaceDataResult>`, omitting spaces the caller can't read.
    Used by the rooms-registry prefetch to front-load the entire space rail in one request on cold
    load.

  - **`batchPullManySpaceAccess(session, spaceIds)`** — fetches only `_access` for many spaces
    via `session.spacesRegistryClient.batchPullMany('spaceregistry', …)`. No `_index` overhead —
    efficient for callers that only need owner/members. Returns
    `Map<spaceId, SpaceRegistrySnapshot>`. On non-429 error returns an empty Map; on 429
    rethrows. Used by the three DM reconcile loops that previously issued one sequential
    `readSpaceAccess` call per space.

  The former **"No cross-space batch"** limitation documented in `batch-space.ts` is now
  resolved. Both helpers use the existing `spaceregistry`/`objindex` collections (compatible
  with the deployed Python `drakkar-sync` server at alpha.25); they do NOT require the new
  alpha.39 `spaceaccess` collection (which would need server-side `spacesCollections()`
  registration).

- **`RoomsRegistryProvider` cross-space prefetch** (`apps/mobile/src/lib/rooms-registry-context.tsx`)
  — a `useEffect` keyed on the `spaces` list now calls `batchPullManySpaceData` for all
  unloaded, non-in-flight spaces when the rail first loads, registering per-space inflight
  promises so concurrent `ensure`/`subscribe` callers coalesce into the batch instead of
  issuing their own per-space requests. Per-space `batchPullSpaceData` is kept as the path for
  `refresh(spaceId)` (post-write reload) and spaces added after the initial prefetch. Extracted
  `finalizeEntry(spaceId, batchResult)` as a shared post-fetch helper (TOFU auto-claim,
  `reconcileSpaceMeta`, result shaping) called from both paths.

### Changed

- **`dm.ts` DM reconcile loops** — `findSharedSpaceWith`, `healDmMap`, and `acceptScannedInvites`
  each previously issued one sequential `readSpaceAccess` call per space. Replaced with a single
  `batchPullManySpaceAccess` call per loop (one or a few HTTP requests for the full set), then
  iterate the result Map. Write operations (`setDmMapping`, `acceptSpaceInvite`) remain
  per-item and sequential — only the reads are batched.

## 0.6.1 (2026-06-23)

### Changed

- Re-pinned `@drakkar.software/starfish-spaces` to `3.0.0-alpha.34` (keyring scope fix).

## 0.6.0 (2026-06-22)

### Added

- **Node-aware attachments** — attachment upload/download respects per-node access (`public` /
  `space` / `invite`), routing through the correct scoped storage path.
- **`NodeAccessRevokedError`** and **`StarfishHttpError`** re-exported from the SDK barrel.

## 0.5.3 (2026-06-22)

### Fixed

- **Owner locked out of their own encrypted-ticket room** (`desk/registry-write.ts`,
  `apps/mobile/src/lib/use-room-open-flow.ts`): after accepting an encrypted ticket request, the
  space owner received "You're not a recipient of this node's keyring" when trying to open the
  resulting room. Root cause: `getNodeAccess`'s `invite+enc` branch resolves `trustedAdders` from
  `reg.owner`, which is the owner's **userId** (`sha256(edPub)[0:32]`, 32 hex). Keyring entries
  record `addedBy` as the owner's **edPub** (64 hex). Since `userId !== edPub`, every keyring entry
  was silently skipped by `createKeyringEncryptor`'s trust check — even though the owner had
  correctly seeded the keyring with its own key during accept. Fixed by opening the per-node keyring
  via a new `ensureDeskNodeKeyring` helper (wrapping `ownerEnsureNodeKeyring`) which uses
  `ownerTrustedAdders(session)` = `[ownerEdPub, selfEdPub]` — the correct edPub-based trust
  anchors. The requester and all non-owner paths are unchanged.

## 0.5.2 (2026-06-22)

### Fixed

- **`/events` 401 Unauthorized — events auth signature host mismatch** — the SSE live-update
  stream (`GET /events?spaces=…`) returned 401 against all deployed servers. Root cause: the
  "thin re-export" SDK refactor (`8f84d34`) replaced OctoChat's own `buildAuthHeaders` with
  starfish-spaces' satellite version, which hardcodes `host: ""` in the per-request Ed25519
  signature. The server's `verifyRequestSignature` binds to the real request host, so the
  signature always mismatched. REST requests were unaffected (they go through
  `StarfishClient.capRequestHeaders` which signs the real host). Restored the local
  `buildAuthHeaders` in `packages/sdk/src/starfish/client.ts` that derives
  `host = new URL(getSyncBase()).host`, matching both the server verifier and the pre-refactor
  behavior.

- **`verifyLinkBinding` missing `await`** — `dm-link.ts` returned a Promise from within a
  `try/catch` without `await`, so the `catch` block could not intercept a rejection from
  `verifyIdentityLinkBinding`. Added `await` for defense-in-depth (the rejection path is
  unreachable in current usage but the fix prevents silent future breakage).

## 0.5.1 (2026-06-22)

### Fixed

- **`_spaces` registry 403 after octospaces-sdk 0.25 / starfish-spaces migration** — two
  independent defects introduced by that migration:

  1. **Wildcard account cap (the 403 root cause)**: `starfish-spaces`' default layout mints
     the account/linked-device cap with `collections: ["*"]`, which the Starfish server's
     literal `cap:read:<col>` role synthesis cannot match against `cap:read:spaces` — causing
     a 403 on every `user/{userId}/_spaces` pull. `configureOctoChat` now installs the OctoChat
     layout module-wide via `configureSpaces({ layout: octoLayout() })`, overriding
     `accountScope`/`linkedDeviceScope` with octospaces-sdk's explicit-collection versions
     (`["profile","devices","spaces","spaceregistry","inbox"]`). All session entry points
     (fresh derivation and vault restore) now receive a cap that satisfies the server's
     literal role check.

  2. **Version skew — `octospaces-sdk@0.11.0` resolved instead of `0.25.0`**: the
     `@drakkar.software/octospaces-platform-sdk@0.1.1` dependency hard-pinned
     `octospaces-sdk@"0.11.0"`, which won the pnpm hoisting race over the declared `0.25.0`.
     The pre-extraction 0.11.0 monolith's `sessionFromPersisted` returns the old Session shape
     (`chatCap`/`chatClient`, no `layout`/`contentCap`/`contentClient`), breaking cold-start,
     unlock, and account-switch restore paths. Bumped `octospaces-platform-sdk` to `0.3.0`,
     which pins `octospaces-sdk@0.25.0` — now `sessionFromPersisted` is the new wrapper that
     injects globals and returns the new Session shape.

- **`Session` type import source in `batch-space.ts` and `node-access-cache.ts`**: these files
  passed the `Session` value to starfish-spaces functions but imported the type from
  `@drakkar.software/octospaces-sdk` (the pre-extraction 0.11.0 shape). Both now import
  `Session` (and `NodeAccess`) from `@drakkar.software/starfish-spaces`.

## 0.5.0 (2026-06-22)

### Breaking

- **Bumped `@drakkar.software/octospaces-sdk` 0.22 → 0.25** and added `@drakkar.software/starfish-spaces 3.0.0-alpha.32` as a new dependency.
- **`Space` type is now lean**: `{ id, name, members }` — `short`, `image`, `unread` are removed from the domain type. The app-layer `SpaceView` type (`spaces-context.tsx`) extends it with these display fields.
- **All registry function signatures changed** from `(client, userId, ...)` to `(client, session, ...)`: `readSpaces`, `writeSpaces`, `writeSpaceAccess`, `readSpaceAccess`, `addJoinedSpace`, `addJoinedSpaceWithCap`, `addSpaceMember`, `reorderSpaces`, `removeJoinedSpace`, `updateDmsDoc`, `updateArchivedDmsDoc`, `updateQuickReactionsDoc`, `updateDeclinedRequestsDoc`, `updateOutgoingRequestsDoc`, `setRequestDeclined`, `setOutgoingRequestRefused`, `recordOutgoingRequest`, `setDmMapping`.
- **`writeSpaces` drops the `hash` parameter** — CAS is handled internally.
- **`verifyIdentityLinkBinding`/`verifyIdentityLinkKeys`** now require `session` as 2nd argument.
- **`resolveLinkOwner`** now requires `session` as 2nd argument.
- **`deriveSession`** now takes `string[]` (array of BIP-39 words) instead of a single string.
- **Starfish package bumps**: `starfish-{client,identities,keyring,sharing,queuing,projection}` → alpha.31; `starfish-protocol` → alpha.32.

### Added

- **`verifyLinkBinding(token)`** — standalone offline identity binding check that does NOT require a session. For anonymous/pre-login use (request link screen).
- **`pullCache()` shim** wrapping `createKvPullCache` from `starfish-client` (keeps `PULL_CACHE_MAX_AGE_MS` stable at 30 days).
- **`fetchWithTimeout(ms?)` shim** wrapping `createTimeoutFetch` from `starfish-client/fetch` (keeps `CONNECT_TIMEOUT_MS = 12_000`).
- **`rootIdentityOf`** re-exported from `octospaces-sdk`.
- **`mutes` and `reads`** fields re-added to the `readSpaces` return (extracted from `extra.mutes` / `extra.reads`).

## 0.4.5 (2026-06-22)

### Fixed

- **Live index refresh via SSE** (`events.shared.ts`): object-index events (`objindex` write —
  node create/rename/reorder) carry only `params.spaceId` and were previously dropped by
  `parseRoomChange`. They are now surfaced as `{ kind: 'index', roomId: spaceId, spaceId }`
  so the client can pull the shared objindex store and repaint the ticket/room list on every
  member's device without bumping unread counts.

## 0.4.4 (2026-06-22)

### Fixed

- **Request storm: 429 amplifier in `batchPullSpaceData`** (`batch-space.ts`): when the batch
  `/batch/pull` responded with HTTP 429, the catch block would immediately fire two more
  individual pulls (`_access` + `_index`) with no back-off — tripling the request count exactly
  when the server was overwhelmed. The fallback is now 429-aware: a 429 is rethrown so the
  registry keeps its last-good cached entry; only genuine "batch not supported" failures (404,
  501, network) fall back to the concurrent individual pulls as intended.
- **Ticket intake robustness** (`intake.ts`): in `reconcileTicketRequests`, the description
  post and the auto-reply shared a single try/catch — a 429 on the description silently dropped
  both. Now each is in its own `try/catch` with a `console.warn` on failure, so a transient
  network error never swallows both messages. Similarly, `acceptNodeRequest`'s description post
  is now best-effort so a transient error can't fail the whole manual accept after the node is
  already created.

## 0.4.3 (2026-06-22)

### Fixed

- **Ticket outbox regression** (`outbox-send.ts`): outbox flush for ticket/invite rooms used
  `streamInvRoomPush(roomId)` which internally derives the space id from the room id — wrong for
  `ticket-<hex>` ids (no embedded space). Now uses `objInvLogPush(entry.spaceId, entry.roomId)`
  with the correct explicit spaceId. Separately, `resolveContext` attempted to read the space's
  `_index` before sending — ticket requesters are not space members and so cannot read that index,
  causing every outbox retry to fail. The fix introduces `entry.access` on `OutboxMessage`: when
  `access === 'invite'`, the index read is skipped and the invite path used directly. Both
  `room/[id].tsx` and `thread/[id].tsx` now thread `spaceId` and `access` through to `useRoomSend`
  so queued ticket messages carry the correct metadata.

### Added

- **Ticket description as first chat message** (`intake.ts`): when a ticket request carries a
  `message` (the requester's description), it is now posted as the first message in the ticket room
  on accept — attributed to the requester — on both the manual accept path (`acceptNodeRequest`) and
  the auto-accept / auto-reply path (`reconcileTicketRequests`). For auto-reply spaces the
  description appears as message #1 and the desk reply as message #2. Empty descriptions are
  silently ignored. Room (shared-invite) requests are unaffected.
- `TICKET_MESSAGE_MAX = 4000` constant in `ticket.ts` — bounds description length before appending
  to the ticket stream.

## 0.4.1 (2026-06-22)

### Added

- Re-export `getNodeKeyringAccessEntry` from `@drakkar.software/octospaces-sdk` so consumers can
  check for a stored per-node keyring cap before calling `buildNodeAccess`, avoiding a doomed
  `_keyring` 403 on plaintext or pending nodes.

## 0.4.0 (2026-06-22)

### Added

- **E2EE support-ticket intake**: `IntakeConfig` gains an `enc?: boolean` field (default `false`).
  When `enc: true` is set on a space's intake config, incoming resource-request tickets are created
  as E2EE nodes — the desk mints a per-node keyring during `acceptResourceRequest`, seals the ticket
  header (`writeSealedTicketInfo`) and the auto-reply after accept, and the requester receives a
  `node-enc` grant bundle with a `keyringCap` they can use to decrypt messages. Fixes the permanent
  `_keyring` 403 on the requester side when the node forces `enc: true`.

### Changed

- `makeTicketCreateHandler(enc = false)`: accepts an `enc` parameter (default `false`) and passes
  it to `createTicketNodeWithReqId`. Back-compat — callers that pass no argument get the same
  plaintext behaviour.
- `acceptNodeRequest`: now reads the space's `IntakeConfig` to derive `enc`, rather than using a
  dummy `manual` config. No change to the call signature — `use-pending-requests.ts` and other
  callers are unaffected.

### Dependencies

- Bumped `@drakkar.software/octospaces-sdk` from `0.20.0` to `0.21.0` (adds `opts.enc` to
  `acceptResourceRequest`).
