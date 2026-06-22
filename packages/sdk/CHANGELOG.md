# Changelog — @drakkar.software/octochat-sdk

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
