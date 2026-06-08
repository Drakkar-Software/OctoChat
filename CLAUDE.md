# OctoChat — pnpm monorepo

Universal (web + native) **Expo** app for **OctoChat**, an end-to-end-encrypted
team chat (Slack/Mattermost-style) with a marine/subaquatic theme and an octopus
mark. Built from the exported Claude Design wireframes and now **wired to a live
backend**: it syncs against a **Starfish** server (default `http://localhost:8787`,
override with `EXPO_PUBLIC_STARFISH_URL`) over REST + SSE, with real end-to-end
encryption (BIP-39 seed → Ed25519/Kyber keys → per-room keyrings).

## Layout

- `apps/mobile` — the Expo (SDK 56) app, package `@octochat/mobile`. Runs on
  iOS, Android and web from one codebase.
- `packages/sdk` — `@drakkar.software/octochat-sdk`, the **headless, publishable
  OctoChat core**: all chat-domain logic with no UI / no React —
  identity & encrypted Starfish sync, the spaces/rooms registry & object tree,
  members/DMs/public spaces, attachments, messages/reactions/threads, reads/mutes
  & notification formatting, automations core, and the domain types/formatters.
  The app consumes it via `workspace:*` and injects platform via `configureOctoChat()`
  + `configureKv()` (see `apps/mobile/src/lib/octochat-init.ts`). The default entry
  (`.`) stays **platform-agnostic and dependency-free**; the platform adapters (kv,
  the seed vault, passkeys, crypto install) live in `packages/sdk/src/platform` and
  ship behind the **optional subpath** `@drakkar.software/octochat-sdk/platform`
  (`.native`/web branched, optional RN peer deps). What stays in the app is React
  (contexts + `use-*` hooks), the env reader (`src/lib/octochat-config.ts`), and the
  app-specific platform modules (`connectivity`/`app-lock`/`notify`/`push`/…).
- `packages/tsconfig` — shared base TypeScript config, package
  `@octochat/tsconfig`, consumed via `workspace:*`.

pnpm workspace. `pnpm-workspace.yaml` sets `nodeLinker: hoisted` because React
Native / Metro resolve dependencies best with a flat `node_modules`
(see https://docs.expo.dev/guides/monorepos/). The
`@drakkar.software/starfish-*` SDK is consumed as pinned npm deps
(`3.0.0-alpha.21`). `apps/mobile/metro.config.js` extends the SDK 56 default to
watch the workspace root, enable package `exports`, and block the Node-only
`apps/server` from the app bundle.

## Commands

- `pnpm install` — install every workspace.
- `pnpm web` / `pnpm start` / `pnpm ios` / `pnpm android` — run the app (filters `@octochat/mobile`).
- `pnpm typecheck` — typecheck all workspaces.

## Design rules — ALWAYS respect

App code lives in `apps/mobile/src`. These rules are non-negotiable:

1. **Reuse components** — build UI from the generic reusables in
   `src/components/**/*.tsx`; extract new components instead of inlining repeats.
2. **One theme source** — ALL constants live in `src/theme.ts`; never hardcode a
   color, size or font in a component, and never compute `rgba()` inline.
3. **Logic in `src/lib/*.ts`** — extract data access, hooks, helpers and
   platform branches there; components/screens only consume them.
4. **Thin route pages** — files in `src/app/**` only read params, pull data from
   `src/lib`, wire navigation, and compose generic components.

The full version (with structure and conventions) is in
[`apps/mobile/CLAUDE.md`](apps/mobile/CLAUDE.md).
