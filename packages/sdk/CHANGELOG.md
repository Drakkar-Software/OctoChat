# Changelog — @drakkar.software/octochat-sdk

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
