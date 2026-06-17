@AGENTS.md

# OctoChat (mobile) — universal Expo app

Encrypted team-chat UI (Slack/Mattermost-style) with a marine "paper-on-subaqua"
theme and an octopus mark. One codebase runs on iOS, Android and web. **Wired to a
live backend**: it syncs against a **Starfish** server (default
`http://localhost:8787`, override with `EXPO_PUBLIC_STARFISH_URL`) over REST + SSE,
with real end-to-end encryption — onboarding derives a BIP-39 seed into
Ed25519/Kyber keys (persisted via `expo-secure-store`) and messages/attachments are
sealed per-room with space keyrings. All chat-domain logic (identity, sync, registry,
messages, automations, …) now lives in the headless **`@drakkar.software/octochat-sdk`**
(`packages/sdk`); the app consumes it through the `use-*` hooks and context providers
and injects platform config/storage at boot via `src/lib/octochat-init.ts`. The
platform adapters (kv, vault, passkey, crypto install) themselves now live in the SDK's
optional `@drakkar.software/octochat-sdk/platform` subpath; what remains app-side is
React glue, the env reader (`src/lib/octochat-config.ts`), and app-specific platform
modules (`connectivity`/`app-lock`/`notify`/`push`/…). The app also depends on
`@drakkar.software/octospaces-ui` (`0.8.0`) for shared UI tokens (theme bridged via
`src/lib/octospaces-theme.ts`). Room access is **per-node** — `ObjectNode.access ∈
{'public','space','invite'}` + `enc: boolean` — surfaced through the `use-room` /
`use-rooms` hooks; no `isPublic` space-level flag.

## Design rules — ALWAYS respect

Non-negotiable. Follow these for every change:

1. **Reuse components.** Build UI from the generic, reusable components in
   `src/components/**/*.tsx` (`ui/`, `brand/`, `chat/`, `onboarding/`). Before
   writing markup, look for an existing component. If you repeat a pattern,
   extract a new reusable component — never copy-paste UI.
2. **One theme source.** EVERY design constant — colors (light & dark), fonts,
   type scale, spacing, radii, shadows, motion — lives in `src/theme.ts`. ALWAYS
   reuse these tokens. Never hardcode a hex, font name or magic size in a
   component, and never compute `rgba()` inline — add a token instead. Read the
   active palette via `useTheme()` (`src/lib/use-theme.ts`).
3. **Logic lives in `src/lib/*.ts`.** ALWAYS extract logic — data access, hooks,
   helpers, platform branches — into `src/lib`. Components and screens consume
   it; they never implement it.
4. **Thin route pages.** Files in `src/app/**` (Expo Router) stay small: read
   route params, pull data from `src/lib` selectors, wire navigation, and compose
   generic components. No business logic and no large inline UI in a page. If a
   page grows, push the UI into a `src/components` component and the logic into
   `src/lib`.

## Structure

- `src/app/` — Expo Router file-based routes. `(onboarding)/` stack
  (welcome, seed, add-device), `(tabs)/` tab navigator (rooms, threads, you),
  `search`, `room/[id]`, `thread/[id]`, `+not-found`. Keep thin.
- `src/components/` — `ui/` primitives (`Txt`, `Button`, `IconButton`, `Card`,
  `Pill`, `Badge`, `Avatar`, `Icon`, `Divider`, `Row`, `Callout`, `AppBar`,
  `Screen`, `StackScreen`, `EmptyState`), `brand/` (`Octopus`, `Wordmark`),
  `chat/`, `onboarding/`.
- `src/lib/` — React hooks + context providers over the SDK: data hooks (`use-room`,
  `use-rooms`, `use-spaces`, `use-search`), session/state (`session-context`,
  `unread-context`, `room-events-bus`), and UI helpers (`use-theme`, `use-app-fonts`,
  `haptics`). Live room-change events come from the SDK's `subscribeRoomChanges`.
  Chat-domain types/logic are imported from `@drakkar.software/octochat-sdk`.
- platform adapters (kv, vault, passkey, crypto install, the argon2 shim) now live in
  the SDK's optional `@drakkar.software/octochat-sdk/platform` subpath, NOT app-side.
  App-side remnants: `src/lib/octochat-config.ts` (the `EXPO_PUBLIC_*` env reader feeding
  `configureOctoChat`) and `src/lib/use-argon2-progress.ts` (the React hook over the
  SDK's argon2 progress emitter). `metro.config.js` aliases `hash-wasm` → the SDK shim
  and resolves the `/platform` subpath from source in dev.
- `src/theme.ts` — design tokens (the single source of truth).

## Conventions

- **Styling:** React Native `StyleSheet` for layout + theme tokens for
  color/size. No CSS, no NativeWind.
- **Text:** render through `<Txt>` (never a bare `<Text>`) so type, weight and
  color stay consistent. Inline spans nest more `<Txt>` inside a `<Txt>` (the RN
  pattern) — see `MessageBody`/`LinkText`. Markdown renders via the generic
  `components/ui/Markdown` (parser in `lib/markdown.ts`, fenced code via
  `components/ui/CodeBlock`); chat code spans via `lib/message-format`.
- **Fonts:** Bricolage Grotesque (display/headings), Hanken Grotesk (body),
  JetBrains Mono (labels, keys, fingerprints, timestamps). Loaded in
  `src/lib/use-app-fonts.ts`; names mirrored in `theme.ts` `fonts`.
- **Cross-platform:** every screen must work on web AND native. Branch with
  `Platform.OS` where needed and keep web parity (web uses
  `web.output: "single"`). Haptics are native-only via `src/lib/haptics.ts`.

## Commands (from the repo root)

- `pnpm web` / `pnpm start` / `pnpm ios` / `pnpm android`
- `pnpm typecheck`

## OTA updates (EAS Update)

- `expo-updates` is wired to EAS Update (`app.json` `updates.url` → `u.expo.dev`,
  `runtimeVersion.policy: appVersion`; channels set per profile in `eas.json`).
- Publish: `eas update --channel <development|preview|production> --message "…"`.
- `appVersion` policy: bump `version` in `app.json` when native deps change, or
  OTA updates won't reach existing builds.
