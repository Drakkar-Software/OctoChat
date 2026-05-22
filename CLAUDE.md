# OctoChat — pnpm monorepo

Universal (web + native) **Expo** app for **OctoChat**, an end-to-end-encrypted
team chat (Slack/Mattermost-style) with a marine/subaquatic theme and an octopus
mark. Built from the exported Claude Design wireframes; currently a
**frontend-only** build driven by placeholder data (no backend / crypto yet).

## Layout

- `apps/mobile` — the Expo (SDK 56) app, package `@octochat/mobile`. Runs on
  iOS, Android and web from one codebase.
- `packages/tsconfig` — shared base TypeScript config, package
  `@octochat/tsconfig`, consumed via `workspace:*`.

pnpm workspace. `pnpm-workspace.yaml` sets `nodeLinker: hoisted` because React
Native / Metro resolve dependencies best with a flat `node_modules`
(see https://docs.expo.dev/guides/monorepos/). Expo SDK 56 needs **no** custom
`metro.config.js` for monorepos — its built-in config handles it.

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
