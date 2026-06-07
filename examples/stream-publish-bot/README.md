# OctoChat stream publish

Publish **one message into a public stream room as a bot**, then exit — in both
**TypeScript** (`ts/`) and **Python** (`python/`). No `/events`, no webhook, no
waiting: just the **post** half of an integration.

```
  publish  ──append──▶  pubstream room
            (audience-cap bot token)
```

A **stream room** is an append-only log, so a bot posts with a single signed
`POST /push` — no pull / merge / hash, no sync protocol. That's the whole point of
the room kind, and it makes "fire a message from a script/cron/CI step" a one-liner.

> Need a *trigger* (react to room activity) instead of a one-shot publish? See the
> sibling [`stream-webhook-bot`](../stream-webhook-bot) example, which adds the
> `/events` listen half.

## The one credential you need

| | Credential | Why |
| --- | --- | --- |
| **Post** (`append`) | the **stream-bot token** | An `audience` cap (`createPublicLink`) scoped to one stream room. It carries no secret: the bot signs with its **own** generated key (`redeemPublicLink` → `X-Starfish-Pub`), so a leaked token is useless and writes stay attributable. |

Get it from a logged-in OctoChat app instance that **owns a public space**: open a
**public stream room** you own ▸ the owner-only **"Connect a bot"** panel ▸
*Generate bot link* ▸ copy the **"Bot link token"** (`OCTOCHAT_BOT_TOKEN`) and the
**"Path to sign"** (`OCTOCHAT_BOT_SIGN_PATH`) fields.

(No public stream room yet? Create a **public** space in the app, add a **stream**
room via the Channel/Stream toggle, then grab the two fields above.)

## Configure

Both implementations read the **same** `.env` at this folder root:

```bash
cp .env.example .env        # then fill OCTOCHAT_BOT_TOKEN + OCTOCHAT_BOT_SIGN_PATH
```

Defaults target the local dev server (`apps/server` on `:8787`). For the deployed
server set `STARFISH_URL=https://dev-sync.drakkar.software/sync` and
`STARFISH_NAMESPACE=octochat`. Set `MESSAGE` to change what's posted.

The append (post) half only needs the **sync server** running — there is no
`/events` / Whistlers bridge dependency here.

## Give the bot a display name

By default the app shows the bot's post under a truncated hex author id (a bot has
no profile). Set **`BOT_NAME`** and the script publishes its **public profile**
`{ pseudo }` *before* posting, so the message renders under that friendly name:

```bash
BOT_NAME=Reef Keeper
```

The `profile` collection is public-**read** but write-gated on the `device:root`
role, granted **only** to a self-signed device cap (`iss === sub`). The bot mints
one over its *own* keypair — the same key it signs the append with — so the server
admits it as `device:root`, and the doc path `user/{identity}/profile` binds to
that key's user id (the `authorId` on the message). Because each run mints a fresh
key, it writes a new profile each run; the example has no stable-identity option
(*Pinning the bot* only allow-lists who may redeem the token — it does not fix the
key), so persist the generated keypair yourself for one profile that survives
restarts. Implemented in both `publish.ts` (`publishProfile`) and `publish.py`
(`publish_profile`).

## Run — TypeScript

```bash
cd ts
# A) standalone (its own install; --ignore-workspace because examples/ is outside
#    the pnpm workspace):
pnpm install --ignore-workspace
pnpm start

# B) zero-install, from the repo root (reuses the workspace's hoisted SDK + tsx):
node_modules/.bin/tsx examples/stream-publish-bot/ts/src/publish.ts
```

## Run — Python

The Starfish **Python SDK is not yet published to PyPI**, so install it editable
from a checkout of the Starfish (`satellite`) monorepo. Pass every interdependent
package in one command (plain `pip` doesn't read the repo's `uv` source map):

```bash
cd python
SAT=/path/to/satellite        # your Starfish source checkout
pip install \
  "$SAT/packages/python/protocol" \
  "$SAT/packages/python/client" \
  "$SAT/packages/python/keyring" \
  "$SAT/packages/python/identities" \
  "$SAT/packages/python/sharing"

python publish.py
```

Requires **Python ≥3.11** (the SDK's `requires-python`). Once the SDK lands on
PyPI this collapses to `pip install starfish-identities starfish-sharing`.

## What you'll see

Both print the server, the bot's `edPub`, and on success:

```
[publish] appended → Hello from the OctoChat publish example 🐙
```

and the line shows up in the stream room in the app.

## What's been checked

- **TypeScript** — typechecked (`tsc --noEmit`) against `@drakkar.software/starfish-*`
  3.0.0-alpha.7 at the time of writing; its append wire format mirrors the app's working
  code. Pins now target 3.0.0-alpha.21 (re-typecheck after bumping).
- **Python** — syntax-checked (`py_compile`); its API surface was a line-for-line port of
  the `starfish-identities` / `starfish-sharing` 3.0.0a7 source. Install editable from a
  3.0.0-alpha.21 Starfish checkout (see above) and re-verify against that surface.

Neither half has been run against a live server here — that needs the sync server
running and a bot token minted from the app (above). The credential plumbing is the
part to watch when you first wire it up.

## Notes

- **Pinning the bot.** The token from the panel lets *any* key redeem it. Each run
  generates a fresh keypair and logs its `edPub`; to restrict, mint a credential
  allow-listing that key.
- **No timestamp games.** The server stamps each appended element with an
  authoritative `ts`; the `ts` the script sends is only a client hint.
- **Files.** [`ts/src/publish.ts`](./ts/src/publish.ts) and
  [`python/publish.py`](./python/publish.py) are mirrors — same config, same
  envelope (`{ t:'msg', e:{ id, authorId, ts, text } }`), same signed wire format.
