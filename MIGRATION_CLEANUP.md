# Migration cleanup — octospaces → dk-spaces (2026-07-06)

Temporary code and notes from the `@drakkar.software/octospaces-sdk@0.29.1` →
`@drakkar.software/dk-spaces-sdk@0.32.0` bump (package rename + starfish TS
`alpha.43` → `alpha.65`). Remove the items below once the rollout window has
passed (all active clients have launched at least once on the new build).

## Remove after rollout

- **KV prefix-rename shims** — `apps/mobile/src/lib/app-kv.ts` (web/localStorage)
  and `apps/mobile/src/lib/app-kv.native.ts` (native/MMKV) each have a one-time
  migration block guarded by the `dk-migration:v1:done` flag that copies:
  - `octospaces.spaceaccess.*` → `dk.spaceaccess.*`
  - `octospaces.profile.v1.*` → `starfish.profile.v1.*`

  Delete both blocks (and the `PREFIX_MIGRATION_FLAG`/`PREFIX_RENAMES` consts)
  once no client is expected to still be running a pre-bump build.

- **Legacy pairing QR prefix acceptance** — `dk-spaces-sdk`'s
  `completeDevicePairing` dual-accepts legacy `octospaces-pair:` /
  `octochat-pair:` QR prefixes alongside the current `octochat-pair:` (see
  `packages/sdk/src/starfish/pairing.ts`). Safe to stop relying on this once all
  active devices have re-paired at least once since the bump (existing paired
  devices are unaffected — this only matters for a QR minted by a stale build
  being scanned after the bump).

## Known limitation — not fixed here

- **Profile-cache migration is intentionally partial.** The `spaceaccess` KV
  shim above is complete (one key per local account, enumerable). The
  `profile.v1.*` cache holds one entry per *other* cached user profile — an
  unbounded set we can't enumerate through the generic `KvAdapter` (`get`/`set`/
  `remove`, no listing) without reaching into raw platform storage more deeply
  than the two shims already do. The shims above DO rename any profile-cache
  keys they find (since they enumerate all keys directly via MMKV/localStorage),
  so this mostly self-heals — but any profile cached under an unusual access
  pattern not covered by that enumeration will just take one cold-read miss on
  next fetch (lossless — it re-fetches live from the server).

## Security-posture note — worth a second look, not urgent

- **`completeDevicePairing`'s `confirmUnpinnedRoot` always returns `true`**
  (`packages/sdk/src/starfish/pairing.ts`). starfish `alpha.63` made root-trust
  verification mandatory on pairing completion (`expectedRootEdPub` or
  `confirmUnpinnedRoot`, else it throws). OctoChat has no prior-pinned root to
  check against at pairing time (the new device is bootstrapping from the scan),
  so trust is granted unconditionally — the actual security boundary remains the
  PIN-sealed bundle + physical QR proximity, same as pre-bump behavior. If a
  stronger posture is wanted later (e.g. prompting the user to confirm a
  fingerprint), this is the place to add it.

## Wire-format note — cross-version invite links

- starfish `alpha.63` changed `encodeLinkFragment`'s wire format to canonical
  `base64url(JSON([origin, path, token]))`. An invite/space link minted by a
  pre-bump (`alpha.43`) client and opened by a post-bump client (or vice versa)
  during the rollout window may fail to decode. No stored data is affected;
  worst case the recipient re-requests a fresh link.

## Operational — not code, don't forget

- The deployed Starfish namespace env var must be updated from `octospaces` to
  `dk`: `EXPO_PUBLIC_STARFISH_NAMESPACE=dk` (see
  `apps/mobile/src/lib/octochat-config.ts`, `apps/desktop/scripts/check-build-env.mjs`).
  This repo's `.env`/`.env.example` files were not checked (sandboxed from this
  session) — verify them directly.
