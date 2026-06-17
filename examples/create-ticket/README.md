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

## Client-side ticket submission without a REST API

`createNodeInviteLink` (and therefore `createTicket`) requires the space owner's
cap to write to the member roster. A client app that only has a member cap — or
no space cap at all — can't call it directly.

The recommended approach is the **sealed resource-request inbox** — a generic
primitive in `@drakkar.software/octospaces-sdk` (`submitResourceRequest` /
`scanResourceRequests` / `acceptResourceRequest` / `scanResourceGrants` /
`acceptResourceGrant`). The requester needs only the bot's **public identity link**
(no cap, no secret, safe to embed anywhere):

```
REQUESTER (any identity; holds only the bot's identity link)
  submitResourceRequest(botLink, { spaceId, nodeType:'ticket', title, meta, message })
    │ verify identity-link binding + live profile cross-check
    │ seal ResourceRequest to bot's KEM key
    └─▶ anonymous append → inbox/{botId}/{shard}

BOT (space owner; reconcile loop)
  scanResourceRequests()
    │ trial-unseal, verify sender identity, dedup by reqId
    └─▶ acceptResourceRequest({ create: makeTicketCreateHandler() })
          ├─▶ createTicketNode(title, TicketMeta, meta.reqId)   ← stamps reqId for dedup
          ├─▶ inviteToNode() → nodeMemberScope cap
          └─▶ seal ResourceGrant → inbox/{requesterId}/{shard}

REQUESTER (poll back)
  scanResourceGrants() → acceptResourceGrant()
    └─▶ nodeMemberScope cap stored → open the ticket room (ticket-scoped access only)
```

The bot's space credentials never touch the client. The entire exchange is E2EE.
The requester ends up with a **ticket-scoped cap only** — they can read/write that
one ticket room and nothing else in the space.

See `ts/src/request.ts` for the full end-to-end demo (both sides in one script).

## How this example differs from the DM example

[`dm-via-link`](../dm-via-link) sends a sealed invite to a pre-existing user via
their `…/dm#…` profile link — both parties must be valid identities.

This example creates a ticket as a **bot/agent session** (the pattern for an
OctoDesk automation or webhook handler). No pre-existing user link is needed.

## Viewing the ticket in OctoChat

The example creates a ticket in whichever space the agent identity owns or is a member
of. To view it in OctoChat you need two preconditions:

1. **Active variant with `tickets` enabled** — `octopulse` (full feature set) and
   `octodesk` (tickets/automations/threads, no channels) both include `tickets`.
   The default `octochat` variant does not.
2. **Matching server + namespace** — the example's `STARFISH_URL` / `STARFISH_NAMESPACE`
   must match the app's `EXPO_PUBLIC_STARFISH_URL` / namespace.

Then choose a path:

**Owner path (recommended) — set `AGENT_SEED` to your app account's seed phrase:**
The agent derives the *same* identity as your app. The new "Drakkar Support" space is
created *by you*, so you see it (and the ticket) as the space owner in OctoChat with no
extra steps.

```bash
AGENT_SEED="word1 word2 ... word24" \
STARFISH_URL=http://localhost:8787 \
  node_modules/.bin/tsx examples/create-ticket/ts/src/ticket.ts
```

If you omit `AGENT_SEED`, a fresh seed is generated and **printed**. Copy those words,
import them into OctoChat (Add account → enter seed phrase), and the "Drakkar Support"
space + ticket will appear.

**Member path — pass a space invite link from your own OctoChat space:**
The agent joins *your* existing OctoDesk space as a member and creates the ticket there.
The ticket appears in the `TicketList` section of your sidebar (no requester invite link
is generated in this mode — the space owner would call `createNodeInviteLink` separately
to grant the requester access).

```bash
SPACE_INVITE_LINK="https://…/join#<token>" \
STARFISH_URL=http://localhost:8787 \
  node_modules/.bin/tsx examples/create-ticket/ts/src/ticket.ts
```

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
| `AGENT_SEED` | *(empty — auto-generate)* | BIP-39 seed phrase (space-separated words). When set, the agent derives a deterministic identity — the same userId across runs. Set this to your OctoChat account's seed to own the created space and view its tickets in the app. When unset, a fresh 24-word seed is generated and printed. |

## Run — TypeScript (direct-create flow)

`ticket.ts` — the bot-owns-the-space path: bot creates the ticket directly.
Run from the **repo root** (reuses workspace deps + `tsx`):

```bash
pnpm --filter @drakkar.software/octochat-sdk build   # ensure dist/ is current
node_modules/.bin/tsx examples/create-ticket/ts/src/ticket.ts
```

Point it at a fresh local server (no NATS / Whistlers needed):

```bash
STARFISH_DATA_DIR=$(mktemp -d) PORT=8799 pnpm --filter @octochat/server start &
STARFISH_URL=http://127.0.0.1:8799 \
  node_modules/.bin/tsx examples/create-ticket/ts/src/ticket.ts
```

## Run — TypeScript (sealed resource-request flow)

`request.ts` — the no-write-all-link path: requester has only the bot's public
identity link; bot creates the ticket and seals a narrow cap back. Zero setup —
creates a fresh bot + space automatically when `BOT_IDENTITY_LINK` is unset:

```bash
pnpm --filter @drakkar.software/octochat-sdk build
STARFISH_DATA_DIR=$(mktemp -d) PORT=8799 pnpm --filter @octochat/server start &
STARFISH_URL=http://127.0.0.1:8799 \
  node_modules/.bin/tsx examples/create-ticket/ts/src/request.ts
```

To wire against a real desk bot, set `BOT_IDENTITY_LINK` (printed by the bot on
startup via `myIdentityLink()`) and `REQUESTER_SPACE_ID`:

| Var | Default | Meaning |
| --- | --- | --- |
| `BOT_IDENTITY_LINK` | *(empty → auto-create)* | Full `<origin>/request#<token>` identity link printed by the desk bot. |
| `REQUESTER_SPACE_ID` | *(empty → auto-create)* | The bot's OctoDesk space id — required when `BOT_IDENTITY_LINK` is set. |
| `BOT_NAME` | `Desk Bot` | Display name for the auto-created bot (default mode only). |
| `REQUESTER_NAME` | `Alice (requester)` | Display name for the requester identity. |
| `TICKET_ORIGIN` | `https://desk.drakkar.software` | Scheme+host used when encoding the identity link (default mode only). |

### How to generate BOT_IDENTITY_LINK and REQUESTER_SPACE_ID

In the default (zero-setup) mode the script auto-creates both and prints them:

```
[req] bot     "Desk Bot" (a3f1c8d2…)
[req] space   "Drakkar Support" → 7e4b9c0f…
[req] link    https://desk.drakkar.software/request#eyJ2IjoxLCJv…
```

Copy the printed values into `examples/create-ticket/.env`:

```bash
BOT_IDENTITY_LINK=https://desk.drakkar.software/request#eyJ2IjoxLCJv…
REQUESTER_SPACE_ID=space-7e4b9c0f…
```

In a production deployment, generate the identity link from the running bot session
with `myIdentityLink(botSession, origin, '/request')` — the link is pure identity
(no cap, no secret) so it is safe to hard-code in client apps or publish as a QR code.
The `REQUESTER_SPACE_ID` is the space id the bot owns (returned by `createSpace` or
visible in the space registry).

> **Note:** you can also run `npm run start` from inside `examples/create-ticket/ts/`
> if `tsx` resolves from the repo root `node_modules` (it will on a hoisted pnpm workspace).
> The `.env` is always loaded from `examples/create-ticket/.env` regardless of where you run from.

Typecheck: `node_modules/.bin/tsc -p examples/create-ticket/ts/tsconfig.json`.

## What you'll see

**Owner path** (new space, full `createTicket`, no `AGENT_SEED` set):

```
[ticket] OctoDesk create-ticket example
[ticket] server   http://127.0.0.1:8799  (local, no namespace)
[ticket] seed     (no AGENT_SEED set — generated a fresh one)
[ticket] seed     abandon ability able about above absent absorb abstract absurd abuse access accident ...
[ticket] seed     ↑ set AGENT_SEED to this phrase to reuse the same identity
[ticket] seed     ↑ import it into OctoChat to view the ticket as the space owner
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
