# OctoChat

End-to-end-encrypted team chat (Slack/Mattermost-style) with a marine theme.
Universal Expo app (iOS, Android, web) + Electron desktop wrapper + Hono backend.

## Prerequisites

- **Node.js** ≥ 20 (tested on 24)
- **pnpm** 10 — `npm i -g pnpm`
- **Docker** (or OrbStack) — for NATS

## Install

```
pnpm install
```

## Dev setup

Three services need to run. Open two terminals:

**Terminal 1 — infrastructure + backend**

```
pnpm infra:up   # start NATS in Docker (detached)
pnpm dev        # Starfish server :8787 + Whistlers SSE :8080
```

**Terminal 2 — frontend**

```
pnpm web        # Expo web  :8081
# or
pnpm ios        # Expo iOS simulator
pnpm android    # Expo Android emulator
pnpm desktop    # Electron wrapper
```

> **Whistlers restart.** `pnpm dev` starts Whistlers once — it does not watch
> for config changes. If you edit `infra/whistlers.config.json` or bump the
> `@drakkar.software/whistlers` package, kill and re-run `pnpm dev` (or
> `pnpm whistlers` on its own).

## Ports

| Service | Port | What |
|---|---|---|
| Expo / Metro | 8081 | Mobile/web app (dev) |
| Starfish server | 8787 | Sync API + `/events` SSE proxy |
| Whistlers | 8080 | Internal NATS→SSE gateway |
| NATS | 4222 | Message bus (Docker) |

## All commands

| Command | What |
|---|---|
| `pnpm infra:up` | Start NATS (Docker, detached) |
| `pnpm infra:down` | Stop all Docker services |
| `pnpm dev` | Starfish server + Whistlers (concurrently, with NATS URLs wired) |
| `pnpm whistlers` | Whistlers SSE gateway only |
| `pnpm dev:server` | Starfish server only (no NATS_URL set) |
| `pnpm web` | Expo web |
| `pnpm ios` | Expo iOS |
| `pnpm android` | Expo Android |
| `pnpm desktop` | Electron wrapper |
| `pnpm desktop:package` | Package Electron app |
| `pnpm typecheck` | TypeScript check all workspaces |
| `pnpm lint` | Lint all workspaces |

## Structure

```
apps/
  mobile/    — Expo SDK 55 app (@octochat/mobile)
  server/    — Hono Starfish server (@octochat/server)
  desktop/   — Electron wrapper (@octochat/desktop)
packages/
  tsconfig/  — shared TypeScript base config
infra/
  whistlers-sse.mjs     — dev launcher for Whistlers (adds CORS)
  whistlers.config.json — Whistlers subscription config
docker-compose.yml      — NATS service
```

See `apps/server/docs/notifications-sse.md` for the SSE delivery architecture.
