# Changelog — @drakkar.software/octochat-sdk

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
