# Changelog — @drakkar.software/octochat-sdk

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
