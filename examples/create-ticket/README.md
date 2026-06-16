# OctoDesk — create ticket

From a **fresh agent identity**, create a support ticket inside an OctoDesk
space, send a reply into the ticket room, update the ticket status, assign it,
and read the conversation back.

Two modes — controlled by `SPACE_INVITE_LINK`:

```
NEW SPACE (default — zero setup):
  agent identity ──createSpace──▶ desk space
       │                                │
       └── createTicket ───────────────▶ ticket room + requesterInviteLink

EXISTING SPACE (set SPACE_INVITE_LINK):
  agent identity ──joinSpaceByLink──▶ existing desk space
       │                                      │
       └── createTicket ────────────────────▶ ticket room + requesterInviteLink
```

Either way, after the ticket is created:

```
send attachment + text ──▶ patchTicketStatus('pending') ──▶ assignTicket
  ──▶ print conversation ──▶ live loop:
        poll every 10 s → print new messages
        stdin line      → send as a new ticket message
        Ctrl+C          → exit
```

A **ticket** is an `ObjectNode` (type `'ticket'`) whose conversation is an
append-only stream log — the same room model as channels and DMs. `createTicket`
mints the node, attaches `TicketMeta` (status, priority, requester, assignee,
SLA deadline), and returns a **`requesterInviteLink`** that a non-member
requester can follow to access just their ticket (per-node cap, no full space
membership required).

## How this differs from the DM example

[`dm-via-link`](../dm-via-link) sends a sealed invite to a pre-existing user
via their `…/dm#…` profile link — both parties must be valid identities and the
DM goes through the inbox delivery path.

This example creates a **support space** from scratch and opens a ticket as a
bot/agent session — the pattern for an OctoDesk automation or webhook handler
where the desk bot already holds a space member cap. No pre-existing user link
is needed; the `requesterInviteLink` output is what you'd email to the requester.

## Configure

```bash
cp .env.example .env   # optional — defaults run end-to-end as-is
```

| Var | Default | Meaning |
| --- | --- | --- |
| `STARFISH_URL` | `http://localhost:8787` | Sync server base URL. |
| `STARFISH_NAMESPACE` | *(empty)* | Bare namespace for a deploy (`octochat`); empty for local. |
| `SPACE_INVITE_LINK` | *(empty)* | A `…/join#<token>` space invite link (or bare `#<token>`). **Empty** ⇒ a fresh space is created. Set this to join a pre-existing OctoDesk space instead. |
| `SPACE_NAME` | `Drakkar Support` | Name of the new space (only used when `SPACE_INVITE_LINK` is empty). |
| `AGENT_NAME` | `Support Bot` | Display name of the agent identity. |
| `TICKET_ORIGIN` | `https://desk.drakkar.software` | Scheme+host used to format the requester invite link URL. |

## Run — TypeScript

This example consumes the **in-repo** SDK. Run from the repo root (reuses the
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

Typecheck: `node_modules/.bin/tsc -p examples/create-ticket/ts/tsconfig.json`.

## What you'll see

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

## Python — not provided (and why)

Same reason as [`dm-via-link`](../dm-via-link#python--not-provided-and-why): the
ticket node creation, `TicketMeta` shape, per-node invite-link flow, and the
stream-room encryptor all live in the TypeScript
`@drakkar.software/octochat-sdk` and have no Python counterpart. The published
Python `starfish-*` SDK only covers raw Starfish primitives (signing, caps,
collections) — the OctoDesk layer on top is TS-only.
