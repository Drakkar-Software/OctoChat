@AGENTS.md

# OctoChat (mobile) — universal Expo app

Encrypted team-chat UI (Slack/Mattermost-style) with a marine "paper-on-subaqua"
theme and an octopus mark. One codebase runs on iOS, Android and web. **Frontend
only** for now: all data is placeholder (`src/lib/placeholder-data.ts`); no
backend, networking or e2ee crypto is wired yet.

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
  (welcome, seed, add-device), `(tabs)/` tab navigator (rooms, search, activity,
  you), `room/[id]`, `thread/[id]`, `+not-found`. Keep thin.
- `src/components/` — `ui/` primitives (`Txt`, `Button`, `IconButton`, `Card`,
  `Pill`, `Badge`, `Avatar`, `Icon`, `Divider`, `Row`, `Callout`, `AppBar`,
  `Screen`, `StackScreen`, `EmptyState`), `brand/` (`Octopus`, `Wordmark`),
  `chat/`, `onboarding/`.
- `src/lib/` — `use-theme`, `use-app-fonts`, `haptics`, `types`,
  `placeholder-data` (typed mock data + selectors).
- `src/theme.ts` — design tokens (the single source of truth).

## Conventions

- **Styling:** React Native `StyleSheet` for layout + theme tokens for
  color/size. No CSS, no NativeWind.
- **Text:** render through `<Txt>` (never a bare `<Text>`) so type, weight and
  color stay consistent.
- **Fonts:** Bricolage Grotesque (display/headings), Hanken Grotesk (body),
  JetBrains Mono (labels, keys, fingerprints, timestamps). Loaded in
  `src/lib/use-app-fonts.ts`; names mirrored in `theme.ts` `fonts`.
- **Cross-platform:** every screen must work on web AND native. Branch with
  `Platform.OS` where needed and keep web parity (web uses
  `web.output: "single"`). Haptics are native-only via `src/lib/haptics.ts`.

## Commands (from the repo root)

- `pnpm web` / `pnpm start` / `pnpm ios` / `pnpm android`
- `pnpm typecheck`
