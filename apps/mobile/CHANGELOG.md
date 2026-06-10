# Changelog

All notable changes to the OctoChat app are documented here, following
[Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

The Expo `runtimeVersion` follows `appVersion`, so bumping `version` (in `app.json`
and `package.json`) fences OTA updates whenever a release carries native changes —
existing installs must take a fresh native build rather than an over-the-air update.

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
