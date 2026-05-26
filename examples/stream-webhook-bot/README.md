# OctoChat stream-webhook bot

A standalone Node script that uses the Starfish **`/events` SSE stream as a
webhook-style trigger** and, on each room change, **appends a line to a public
stream room as a bot** — using only the published `@drakkar.software/starfish-*`
SDK, no app code.

```
  /events (SSE)  ──trigger──▶  handler  ──append──▶  pubstream room
   (member cap)                                (audience-cap bot token)
```

A **stream room** is an append-only log, so a bot posts with a single signed
`POST /push` — no pull / merge / hash, no sync protocol. That's the whole point of
the room kind.

## Why two credentials?

The listen and post sides need *different* caps, and that's deliberate:

| Side | Credential | Why |
| --- | --- | --- |
| **Listen** (`/events`) | a **read-only public-space invite link** | `/events` verifies a per-request signature against a cap's subject and **rejects audience caps** (they have no single subject — `apps/server/src/events.ts`). An invite link carries a `member` cap + its signing key, which `/events` accepts. |
| **Post** (`append`) | the **stream-bot token** | An `audience` cap (`createPublicLink`) scoped to one stream room. It carries no secret: the bot signs with its **own** generated key (`redeemPublicLink` → `X-Starfish-Pub`), so a leaked token is useless and writes stay attributable. |

## Where the two credentials come from

Both are produced by a logged-in OctoChat app instance that **owns a public space**:

1. **`OCTOCHAT_INVITE_LINK`** — open a **public** space ▸ invite/share ▸ generate a
   **read-only** link (the `…/join#…` URL). Paste the whole URL.
2. **`OCTOCHAT_BOT_TOKEN`** + **`OCTOCHAT_BOT_SIGN_PATH`** — open a **public stream
   room** you own ▸ the owner-only **"Connect a bot"** panel ▸ *Generate bot link*.
   Copy the **"Bot link token"** and the **"Path to sign"** fields.

(No public space yet? Create one in the app, add a **stream** room to it via the
Channel/Stream toggle, then grab both credentials above.)

## Run

Defaults target the **local dev server** (`apps/server` on `:8787`). Note the two
halves need different things running:

- **append** (post side) only needs the sync server (`apps/server`).
- **`/events`** (trigger side) is a proxy in front of the Whistlers NATS→SSE bridge
  (`WHISTLERS_INTERNAL_URL`, default `:8080`) — the same infra the app uses. Without
  it, `/events` returns 503 and the bot just reconnect-loops (correctly) without
  ever firing. See the Infra repo to run the bridge.

```bash
cp .env.example .env        # then fill in the four values from the app
```

Then either:

```bash
# A) standalone (its own install; --ignore-workspace because examples/ is outside
#    the pnpm workspace):
pnpm install --ignore-workspace
pnpm start

# B) zero-install, from the repo root (reuses the workspace's hoisted SDK + tsx):
node_modules/.bin/tsx examples/stream-webhook-bot/src/bot.ts
```

On start it prints the server, space, target room, and the bot's `edPub`. Once the
SSE stream is up, posting in a watched room logs `[bot] appended → 🔔 activity in …`
and the line shows up in the stream room in the app.

### Against the deployed server

Set `STARFISH_URL=https://dev-sync.drakkar.software/sync` and
`STARFISH_NAMESPACE=octochat`. **Caveat:** the deployed Whistler→SSE bridge is
currently not delivering live events (it connects but pushes nothing — known
upstream issue), so against the deploy the bot connects to `/events` but its
trigger won't fire. The **append** half is unaffected.

### What's been checked

This example is **typechecked** (`pnpm typecheck`) and its `/events` auth + append
wire format mirror the app's working code and the compiled SDK exactly. It has
**not** been run against a live server here — that needs the sync server + Whistlers
bridge running and the two credentials minted from the app (above). The credential
plumbing is the part to watch when you first wire it up.

## Customize the handler

`onTrigger` in [`src/bot.ts`](./src/bot.ts) is the webhook handler — the only part
you'd normally change. `/events` carries **no message content** (only "room X
changed"), so the default just posts an activity line. To do real work, pull the
changed room there (the member cap can read public channels), call an external API,
etc., then `appendToStream(...)` to post the result back.

## Notes

- **Loop guard.** The bot never reacts to changes in its **own** stream room — its
  append re-emits the same `octochat.chat.changed.<spaceId>` topic, so reacting
  would loop forever. Use `WATCH_ROOM` to also pin a single source room.
- **Pinning the bot.** The token from the panel lets *any* key redeem it. The bot
  logs its `edPub` on startup; to restrict, mint a credential allow-listing that key.
- **Files.** [`subscribe.ts`](./src/subscribe.ts) (the SSE trigger),
  [`append.ts`](./src/append.ts) (the audience-cap append), [`bot.ts`](./src/bot.ts)
  (config + wiring + handler).
