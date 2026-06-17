# Changelog

All notable changes to the OctoChat app are documented here, following
[Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

The Expo `runtimeVersion` follows `appVersion`, so bumping `version` (in `app.json`
and `package.json`) fences OTA updates whenever a release carries native changes —
existing installs must take a fresh native build rather than an over-the-air update.

## [1.14.2] — 2026-06-17

### Fixed
- **DM live notifications + unread** now delivered (web SSE, native FCM, in-app badge). The
  `/events` proxy + FCM bridge authorize a space from `spaces/{id}/_access.{owner,members}`
  (the member cap that gates reads is ignored), so a DM whose peer was missing from that
  roster loaded history but received no live events. DMs now seed the peer into the roster at
  creation, and a reconcile-time self-heal (`healDmRosters`) repairs DMs created earlier.
- **Ticket notifications + unread**: the notification resolvers no longer re-derive a bogus
  space from `ticket-<hex>` room ids — they use the real `spaceId` the SSE event / FCM
  payload carries; ticket unread is exempt from the reload prune.
- **Request-link card** is now visible on non-desk builds (the shareable request link can
  request a private room, not only a ticket); the ticket intake-mode selector stays gated.

## [1.11.0] — 2026-06-16

### Added
- **Variant / white-label system.** Three build variants (`octochat`, `octodesk`,
  `octopulse`) controlled by `EXPO_PUBLIC_VARIANT` at EAS build time. Each variant
  declares a feature set; the runtime `BrandProvider` + `useFeature()` hook gate UI
  sections on capabilities. Set variant via `eas.json` build profile (new
  `octodesk-*` and `octopulse-*` profiles added) or the env var in dev.
- **OctoDesk ticket sub-app** (gated on the `tickets` capability). A `TicketList`
  sidebar section appears in the rooms tab when the active variant supports tickets.
  Each ticket is a dedicated room node (`type: 'ticket'`) with a `StatusPill`
  (open / pending / solved / closed) and requester label.
- **OctoDesk theme tokens**: `accentDesk`, `accentDeskSoft`, `accentDeskBg`,
  `accentDeskBorder` added to `src/theme.ts` (warm brown palette, light + dark).
- **Dynamic `app.config.js`**: Expo config now reads `EXPO_PUBLIC_VARIANT` and
  applies per-variant name, slug, bundle ID, scheme, EAS project ID and deep-link
  host — one repo, three publishable apps.

### SDK (octochat-sdk)
- **Capability registry** (`domain/capabilities.ts`): `Capability` type union
  (`channels | dms | threads | automations | tickets`) + `CAPABILITY_META` record
  with labels, descriptions, and room-type mappings.
- **Ticket model** (`desk/ticket.ts`): `TicketStatus`, `TicketPriority`,
  `TicketMeta` interface, and pure helpers (`ticketOf`, `withTicket`,
  `isTicketNode`, `defaultTicketMeta`).
- **Ticket orchestrator** (`desk/orchestrator.ts`): `createTicket` (creates an
  object-index node + returns a requester invite link via `createNodeInviteLink`),
  `patchTicketStatus`, `assignTicket`.
- **`ticket` builtin object type** wired into `domain/object-types.ts` /
  `domain/types.ts`; `meta` field added to `NewObjectInput` in
  `starfish/objects.ts`.
- **Two new automation providers**: `desk-autoreply`, `desk-sla`.
- All new SDK symbols are exported from the package root.

## [1.10.0] — 2026-06-10

### Changed
- Upgrade **`@drakkar.software/expo-conductor` 0.2.2 → 0.4.1**. This pulls in native
  (Android) changes — optional Rust FFI handlers, a `buildConfig` feature, and an
  FCM doze-bypass foreground service — so a **new native build is required**; OTA
  updates from 1.9.0 are intentionally **not** compatible (runtimeVersion = appVersion).
  FCM stays disabled (`enableFcm: false`); the config plugin options are unchanged and
  no pnpm patch is needed (firebase-messaging is `compileOnly` upstream, so the service
  Kotlin compiles without bundling Firebase).

### Improved
- Design elevation across the app on the existing marine design system: signature
  moments (bioluminescent identity hero, device-pairing "verified" seal, a send-button
  payoff, and a space-switch room-list cascade), richer empty and loading states,
  added depth and display-type hierarchy, and reduced-motion-safe motion throughout.
