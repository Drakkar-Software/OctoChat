# OctoDesk — create ticket

From a **fresh agent identity**, create a support ticket inside an OctoDesk
space, send a reply with a file attachment, then enter a live loop: poll the
ticket room every 10 s for new messages and accept stdin replies until Ctrl+C.

Two modes — controlled by `SPACE_INVITE_LINK`:

```
NEW SPACE (default — zero setup, agent owns the space):
  agent identity ──createSpace──▶ desk space
       │                                │
       └── createTicket ───────────────▶ ticket room + requesterInviteLink

EXISTING SPACE (set SPACE_INVITE_LINK — agent joins as member):
  agent identity ──joinSpaceByLink──▶ existing desk space
       │                                      │
       └── createTicketNode ────────────────▶ ticket room  (no invite link — see below)
```

Either way, after the ticket is created:

```
send attachment + text ──▶ patchTicketStatus('pending') ──▶ assignTicket
  ──▶ print conversation ──▶ live loop:
        poll every 10 s → print new messages
        stdin line      → send as a new ticket message
        Ctrl+C          → exit
```

## Requester invite link — ticket-scoped access

A **requester invite link** (`requesterInviteLink`) lets an external, non-member
user open *just their ticket room* — not the whole space. It is a per-node cap
(`access: 'invite'`): the server enforces that the bearer can only read/write the
single ticket room they were invited to.

```
createTicket()
  └─▶ createNodeInviteLink()        ← adds a per-node member to the space roster
        └─▶ requesterInviteLink      ← send this to alice@example.com
```

The requester opens the link → accepts the per-node invite → can now read/write
messages in that ticket room only. They never see other tickets or channels.

**Why the member path can't issue one:** `createNodeInviteLink` internally writes
to the space member roster (`spaceAccessPush`), which requires the space owner's
cap. A session that joined via `SPACE_INVITE_LINK` holds only a member cap — the
roster write is denied with HTTP 403. In that mode the example falls back to
`createTicketNode` (roster-free), so the ticket is created but no invite link is
generated. The space owner would need to call `createNodeInviteLink` separately to
grant the requester access.

## How this differs from the DM example

[`dm-via-link`](../dm-via-link) sends a sealed invite to a pre-existing user via
their `…/dm#…` profile link — both parties must be valid identities.

This example creates a ticket as a **bot/agent session** (the pattern for an
OctoDesk automation or webhook handler). No pre-existing user link is needed.

## Configure

Place your `.env` file at `examples/create-ticket/.env` (next to `.env.example`):

```bash
cp examples/create-ticket/.env.example examples/create-ticket/.env
# then edit examples/create-ticket/.env
```

| Var | Default | Meaning |
| --- | --- | --- |
| `STARFISH_URL` | `http://localhost:8787` | Sync server base URL. |
| `STARFISH_NAMESPACE` | *(empty)* | Bare namespace for a deploy (`octochat`); empty for local. |
| `SPACE_INVITE_LINK` | *(empty)* | A `…/join#<token>` space invite link (or bare `#<token>`). **Empty** ⇒ a fresh space is created (owner path, full `createTicket` + invite link). Set this to join a pre-existing space (member path, `createTicketNode` only — no requester invite link). |
| `SPACE_NAME` | `Drakkar Support` | Name of the new space (only used when `SPACE_INVITE_LINK` is empty). |
| `AGENT_NAME` | `Support Bot` | Display name of the agent identity. |
| `TICKET_ORIGIN` | `https://desk.drakkar.software` | Scheme+host for the requester invite link URL (owner path only). |

## Run — TypeScript

This example consumes the **in-repo** SDK. Run from the **repo root** (reuses the
workspace's hoisted deps + `tsx` — no per-example install needed):

```bash
# from the repo root
pnpm --filter @drakkar.software/octochat-sdk build   # ensure dist/ is current
node_modules/.bin/tsx examples/create-ticket/ts/src/ticket.ts
```

Point it at a fresh local server (no NATS / Whistlers needed):

```bash
STARFISH_DATA_DIR=$(mktemp -d) PORT=8799 pnpm --filter @octochat/server start &
STARFISH_URL=http://127.0.0.1:8799 \
  node_modules/.bin/tsx examples/create-ticket/ts/src/ticket.ts
```

> **Note:** you can also run `npm run start` from inside `examples/create-ticket/ts/`
> if `tsx` resolves from the repo root `node_modules` (it will on a hoisted pnpm workspace).
> The `.env` is always loaded from `examples/create-ticket/.env` regardless of where you run from.

Typecheck: `node_modules/.bin/tsc -p examples/create-ticket/ts/tsconfig.json`.

## What you'll see

**Owner path** (new space, full `createTicket`):

```
[ticket] OctoDesk create-ticket example
[ticket] server   http://127.0.0.1:8799  (local, no namespace)
[ticket] agent    "Support Bot" (a3f1c8d2…)
[ticket] space    "Drakkar Support" created → space-7e4b9c0f…
[ticket] created  ticket ticket-2d8e1a7b…
[ticket] invite   https://desk.drakkar.software/join#eyJ2Ijox…
[ticket] sent     attachment safari-error.png (70 B, kind=image)
[ticket] sent     initial reply
[ticket] status   open → pending
[ticket] assigned → a3f1c8d2… (Support Bot)

[ticket] ── conversation (2 message(s)) ──
[ticket]   Support Bot: 📎 safari-error.png [image] — 70 B decrypted
[ticket]   Support Bot: Hi Alice! I can reproduce this — looking into it now. Could you share your Safari version?

[ticket] ── live (polling every 10s · type to reply · Ctrl+C to quit) ──
Can you also try clearing cache?
[ticket]   (message sent)
[ticket]   Support Bot: Can you also try clearing cache?
^C
[ticket] done.
```

**Member path** (existing space via `SPACE_INVITE_LINK`):

```
[ticket] joined   existing space → sp-48521ba952b06d7eb960b96655d9f1ee
[ticket] created  ticket ticket-9f3c2a1d…  (member mode — no requester invite link)
…
```

## Python — not provided (and why)

Same reason as [`dm-via-link`](../dm-via-link#python--not-provided-and-why): the
ticket node creation, `TicketMeta` shape, per-node invite-link flow, and the
stream-room encryptor all live in the TypeScript
`@drakkar.software/octochat-sdk` and have no Python counterpart.
