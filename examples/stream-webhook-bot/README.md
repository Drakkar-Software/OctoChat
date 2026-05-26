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
`STARFISH_NAMESPACE=octochat`. The deployed Whistler→SSE bridge **does** deliver live
events (verified: a raw `/events` capture showed each post arriving as a `pubstream`
change), so the trigger fires against the deploy. If a run looks silent, check that
`WATCH_ROOM`/`LOOP_GUARD` actually let the changed room through (SSE is live-only and
heartbeats are ignored), not that the bridge is down.

### What's been checked

**Confirmed end-to-end against the deployed server** (`dev-sync.drakkar.software`):
the bot connected to `/events`, a post in a watched channel triggered it live, and it
appended back to the stream room. Also `pnpm typecheck`-clean. (The first run looked
silent only because nothing was posted during its window — SSE is live-only and the
bot ignores heartbeats.)

## Customize the handler

`onTrigger` in [`src/bot.ts`](./src/bot.ts) is the webhook handler — the only part
you'd normally change. `/events` carries **no message content** (only "room X
changed"), so the default just posts an activity line. To do real work, pull the
changed room there (the member cap can read public channels), call an external API,
etc., then `appendToStream(...)` to post the result back.

## Answer with an LLM (OpenAI / NVIDIA NIM)

By default the bot posts a 🔔 activity line. Set **`LLM_API_KEY`** and it instead
**answers the room with an LLM** — reading the recent messages and appending the
model's reply as a bot post.

Both providers speak the **same** OpenAI chat-completions wire format, so one client
(`openai`) drives both — only the `baseURL` / key / model differ:

| Provider | `LLM_PROVIDER` | Default base URL | Example model |
| --- | --- | --- | --- |
| OpenAI standard | `openai` (default) | `https://api.openai.com/v1` | `gpt-4o-mini` |
| NVIDIA NIM (hosted) | `nvidia` | `https://integrate.api.nvidia.com/v1` | `google/gemma-4-31b-it` |
| NVIDIA NIM (self-hosted) | `nvidia` + `LLM_BASE_URL` | `http://localhost:8000/v1` | whatever the container serves |

Add to your `.env` (only `LLM_API_KEY` is required — its presence is what flips the
bot from echo to LLM mode):

```bash
LLM_PROVIDER=openai      # or: nvidia — picks the default base URL + model
LLM_API_KEY=sk-…         # REQUIRED to enable LLM mode (unset ⇒ echo mode)
# Optional overrides:
# LLM_BASE_URL=http://localhost:8000/v1     # self-hosted NIM, or any OpenAI-compatible endpoint
# LLM_MODEL=gpt-4o-mini
# LLM_SYSTEM_PROMPT=You are a helpful marine-biology tutor.
# LLM_TEMPERATURE=0.7
# LLM_MAX_TOKENS=512
# LLM_HISTORY=16                            # how many recent turns to feed as context
```

Two requirements specific to LLM mode:

- **Use the standalone install (option A).** `openai` is a dependency of *this*
  example, not of the workspace, so the zero-install option B can't resolve it.
- **`LOOP_GUARD=skip-author` is required.** The LLM answers by reading the target
  room's text, which `skip-room` never pulls — so LLM mode + `skip-room` exits at
  startup with a one-line hint. Point `WATCH_ROOM` at the bot's own stream room (the
  last path segment of the sign path) and it answers every human post there.

The bot's own replies carry its `authorId`, so they map to `assistant` turns and
never re-trigger it; an LLM/network error simply skips that one reply (no append, so
it can't crash the bot or trip the circuit breaker). The LLM only fires in the room
it can read (its own stream room) — for any other watched room it stays silent.

**Answer only when @-mentioned?** The default answers every human post. For a busier
channel, gate it in `llmReply` (bot.ts) — e.g. proceed only when the newest user turn
starts with `@octo`.

## Loop guard (two modes, set via `LOOP_GUARD`)

A `pubstream` append re-emits the same `octochat.chat.changed.<spaceId>` topic, so a
bot that reacts to its own posts loops forever. `/events` frames carry **no author**,
so the bot can't tell its own append from anyone else's by the event alone. Two ways
to handle it:

- **`skip-room`** (default) — never react to *any* change in the bot's own target
  room. Stateless and impossible to loop, but the bot can't react to others' posts in
  that room. (This is why posting in the *same* room the bot writes to does nothing.)
- **`skip-author`** — on a target-room change, the bot **pulls the new posts** (its
  token grants `read` on that room) and reacts only to those **not authored by it**,
  tracked by a checkpoint. Now it can watch *and* post in the same room. Costs one
  pull per change and a little state.

Either way, `WATCH_ROOM` can pin a single source room.

### Authorship proof — a known limitation

`skip-author` decides "is this mine?" by reading the post's **self-declared**
`authorId` field. That's a **trust assumption, not proof**: any writer can put your
bot's `authorId` in their post to suppress a reaction, and nothing cryptographically
binds the stored element to the key that wrote it. (The append *request* is signed —
the bot's `X-Starfish-Pub`, which the server verifies — but that verified identity
isn't stamped onto the stored element a reader sees.)

**The fix belongs in the Starfish SDK, not here.** The canonical format already
exists — `authorPubkey` + `authorSignature` (Ed25519 over the stable-stringified
payload), produced by `SyncManager` for merge-doc pushes. The only gap is that
`client.append` doesn't thread the same `SyncSigner`, so stream elements go unsigned.
Closing it (sign on append + an exported verify helper) makes authorship verifiable
for *every* reader and stays consistent with merge docs — reimplementing it in this
example would fork a security primitive and still wouldn't help until the app signs
its own stream posts too. **Today this example trusts `authorId`; when the SDK exposes
signed appends, the author check switches to verifying `authorPubkey`/`authorSignature`
and comparing public keys.**

## Notes

- **Pinning the bot.** The token from the panel lets *any* key redeem it. The bot
  logs its `edPub` on startup; to restrict, mint a credential allow-listing that key.
- **Files.** [`subscribe.ts`](./src/subscribe.ts) (the SSE trigger),
  [`append.ts`](./src/append.ts) (the audience-cap append + bot-authed pull),
  [`bot.ts`](./src/bot.ts) (config + wiring + handler).
