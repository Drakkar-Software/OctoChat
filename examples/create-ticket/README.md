# OctoDesk — create ticket

Three small TypeScript examples that drive the OctoDesk ticket flow against a live
**Starfish** sync server, using the in-repo `@drakkar.software/octochat-sdk`. A
ticket is an `access:'invite'` object node whose conversation lives in the per-node
**invite log** (`objinvlog`) — reachable only via a per-node cap, never the broad
space cap.

## The three examples at a glance

| Script | `pnpm` (from `ts/`) | What it does | Use when |
| --- | --- | --- | --- |
| `seed-ticket.ts` | `start:seed-ticket` | Creates a ticket **in your own account** (your seed) and posts a message into its objinvlog — then prints how to open it in the app. | **You want to SEE a ticket in the OctoChat app** and verify the owner can read it. |
| `ticket.ts` | `start:ticket` | Standalone interactive desk CLI: one process creates a ticket and chats in it (poll + stdin). Self-contained. | You want a quick end-to-end CLI demo of the desk side. |
| `request.ts` | `start:request` | The sealed **resource-request** round-trip: a fresh requester (holding only the bot's public link) files a ticket; the bot accepts and seals back a ticket-scoped cap; both sides read the conversation. | You want the no-cap client-submission flow end-to-end. |

> Run any of them from the repo root, e.g.
> `node_modules/.bin/tsx examples/create-ticket/ts/src/seed-ticket.ts`,
> or from `examples/create-ticket/ts/` with `pnpm start:seed-ticket`. The `.env` is
> always loaded from `examples/create-ticket/.env`. Build the SDK first:
> `pnpm --filter @drakkar.software/octochat-sdk build`.

## ⚠️ To see a ticket in the OctoChat app — read this first

Most "I ran it but see no tickets" confusion comes from one of these. All three must hold:

1. **Same identity, same space.** A ticket is only visible to the account that owns
   (or is a member of) the space it lives in. `request.ts` and the default `ticket.ts`
   run as a **throwaway identity in their own space** — you can't log into the app as
   them (`request.ts`'s bot has random keys, *no seed*). To view a ticket in YOUR app,
   create it **as your account**: use **`seed-ticket.ts` with `AGENT_SEED` = your app
   seed** (and optionally `SPACE_ID` = a space you already own).
2. **A variant with the `tickets` feature.** The default **`octochat`** variant does
   **NOT** show tickets (`apps/mobile/src/lib/variants.ts`). Launch the app with
   `EXPO_PUBLIC_VARIANT=octodesk` (or `octopulse`) or the Tickets shelf stays hidden
   even when tickets exist.
3. **Matching server + namespaces.** The example's `STARFISH_URL` / `STARFISH_NAMESPACE`
   must match the app's `EXPO_PUBLIC_STARFISH_URL` / namespace, and
   `SHARED_SPACES_NAMESPACE` must match the app's `EXPO_PUBLIC_SHARED_SPACES_NAMESPACE`
   (defaults to `STARFISH_NAMESPACE`) — otherwise a newly created space won't appear in
   the sidebar even with the right identity. (Not needed when you target an existing
   `SPACE_ID` you already see in the app.)

The owner reads the ticket's objinvlog via a per-node cap it re-mints on open (it is the
cap issuer); the requester reads via the cap sealed to them. The broad owner *device* cap
is **not** honoured for objinvlog — which is why a ticket created elsewhere still opens.

---

## `seed-ticket.ts` — create a viewable ticket in YOUR account

Derives the desk identity from a BIP-39 **seed** (so it can be your app account) and writes
the ticket message into the per-node invite log (`objinvlog`) via
`getNodeStreamClient` + `objInvLogPush` — the **same** stream + cap path the app's room
screen reads. Reads it back to prove the round-trip.

```bash
AGENT_SEED="word1 word2 … word12" \
SPACE_ID=sp-48521ba9…            \
STARFISH_URL=https://dev-sync.drakkar.software/sync STARFISH_NAMESPACE=octospaces \
  node_modules/.bin/tsx examples/create-ticket/ts/src/seed-ticket.ts
```

Then open the app **as that account**, with `EXPO_PUBLIC_VARIANT=octodesk`, navigate to the
space → **Tickets** shelf → open the ticket.

| Var | Default | Meaning |
| --- | --- | --- |
| `AGENT_SEED` | *(empty → generate + print)* | Your OctoChat account's BIP-39 seed (space-separated words). The ticket is created AS this identity. Omit and a fresh 12-word seed is printed to import. |
| `SPACE_ID` | *(empty → create a new space)* | An **existing** space this identity **owns** (e.g. `sp-48521ba9…`). Omit to create a fresh `Drakkar Support` space. |
| `TICKET_TITLE` | `Login fails on Safari 17` | Ticket subject. |
| `TICKET_REQUESTER` | `alice@example.com` | Ticket requester field. |
| `AGENT_NAME` | `Desk Owner` | Display name for the identity. |
| `STARFISH_URL` · `STARFISH_NAMESPACE` · `SHARED_SPACES_NAMESPACE` | see [shared](#shared-config) | Server + namespaces — must match the app. |

---

## `ticket.ts` — standalone interactive desk CLI

One process creates a ticket and chats in it: send an attachment + reply, set status,
assign, then poll every 10 s and accept stdin replies until Ctrl+C. Two modes via
`SPACE_INVITE_LINK`:

```
NEW SPACE (default — agent owns the space):
  agent ──createSpace──▶ space ──createTicket──▶ ticket room + requesterInviteLink
EXISTING SPACE (set SPACE_INVITE_LINK — agent joins as member):
  agent ──joinSpaceByLink──▶ space ──createTicketNode──▶ ticket room (no invite link)
```

```bash
STARFISH_DATA_DIR=$(mktemp -d) PORT=8799 pnpm --filter @octochat/server start &
STARFISH_URL=http://127.0.0.1:8799 \
  node_modules/.bin/tsx examples/create-ticket/ts/src/ticket.ts
```

> **App-view caveat:** `ticket.ts` posts to the space-tier stream, not `objinvlog`, so its
> messages won't appear when you open the ticket in the app. It's a self-contained CLI demo
> — to view a ticket (with its conversation) in the app, use **`seed-ticket.ts`** above.

| Var | Default | Meaning |
| --- | --- | --- |
| `SPACE_INVITE_LINK` | *(empty → new space)* | A `…/join#<token>` link. Empty ⇒ fresh space (owner path, full `createTicket` + invite link). Set ⇒ join as member (`createTicketNode` only, no requester invite link — roster write is owner-only, 403 for a member). |
| `SPACE_NAME` | `Drakkar Support` | New-space name (owner path only). |
| `AGENT_NAME` | `Support Bot` | Display name of the agent identity. |
| `AGENT_SEED` | *(empty → generate + print)* | BIP-39 seed; set to reuse the same identity across runs. |
| `TICKET_ORIGIN` | `https://desk.drakkar.software` | Scheme+host for the requester invite link (owner path). |
| `STARFISH_URL` · `STARFISH_NAMESPACE` · `SHARED_SPACES_NAMESPACE` | see [shared](#shared-config) | Server + namespaces. |

---

## `request.ts` — sealed resource-request round-trip

A fresh requester holding **only the bot's public identity link** files a ticket; the bot
accepts and seals a narrow ticket-scoped cap back; both sides read the conversation. Zero
setup — auto-creates a bot + space (persisted to `.bot-state.json`) when `BOT_IDENTITY_LINK`
is unset.

```bash
STARFISH_DATA_DIR=$(mktemp -d) PORT=8799 pnpm --filter @octochat/server start &
STARFISH_URL=http://127.0.0.1:8799 \
  node_modules/.bin/tsx examples/create-ticket/ts/src/request.ts
```

> **Note:** the auto-created bot uses **random keys** (no seed) in its **own** space, so its
> tickets can NOT appear in your app account. This script demonstrates the protocol, not
> app-side viewing — for that use `seed-ticket.ts`.

| Var | Default | Meaning |
| --- | --- | --- |
| `BOT_IDENTITY_LINK` | *(empty → auto-create)* | Full `<origin>/request#<token>` link printed by a running desk bot (`myIdentityLink(session, origin, '/request')`). Pure identity, no secret — safe to publish. |
| `REQUESTER_SPACE_ID` | *(empty → auto-create)* | The bot's space id — required when `BOT_IDENTITY_LINK` is set. |
| `BOT_NAME` | `Desk Bot` | Auto-created bot display name (default mode). |
| `REQUESTER_NAME` | `Alice (requester)` | Requester display name. |
| `TICKET_ORIGIN` | `https://desk.drakkar.software` | Scheme+host for the encoded identity link (default mode). |
| `STATELESS` | *(unset)* | `1` ⇒ skip the `.bot-state.json` snapshot (ephemeral identity; CI). |
| `STARFISH_URL` · `STARFISH_NAMESPACE` | see [shared](#shared-config) | Server + namespace. |

---

## <a name="shared-config"></a>Configure (`.env`)

All three scripts load one file, `examples/create-ticket/.env`, sectioned by example:

```bash
cp examples/create-ticket/.env.example examples/create-ticket/.env
# then edit examples/create-ticket/.env
```

The shared keys apply to every script:

| Var | Default | Meaning |
| --- | --- | --- |
| `STARFISH_URL` | `http://localhost:8787` | Sync server base URL. Match the app's `EXPO_PUBLIC_STARFISH_URL`. |
| `STARFISH_NAMESPACE` | *(empty)* | Bare namespace for a deploy (e.g. `octospaces`); empty for local. |
| `SHARED_SPACES_NAMESPACE` | *(= `STARFISH_NAMESPACE`)* | Namespace for the `user/{userId}/_spaces` joined-space list. Must match the app's `EXPO_PUBLIC_SHARED_SPACES_NAMESPACE` or a newly created space won't show in the sidebar. |

`.env.example` mirrors this layout (shared block + one commented block per example). If you
need to recreate it:

```env
# ── shared (all examples) ──────────────────────────────────────────────
STARFISH_URL=http://localhost:8787
STARFISH_NAMESPACE=
SHARED_SPACES_NAMESPACE=

# ── seed-ticket.ts — create a ticket in YOUR app account ───────────────
# AGENT_SEED="word1 word2 … word12"   # your OctoChat seed (omit → printed)
# SPACE_ID=sp-…                        # existing space you own (omit → new space)
# TICKET_TITLE=Login fails on Safari 17
# TICKET_REQUESTER=alice@example.com

# ── ticket.ts — standalone interactive desk CLI ────────────────────────
# AGENT_SEED="word1 word2 … word12"
# SPACE_INVITE_LINK=https://…/join#<token>   # join existing space as member (else new space)
# SPACE_NAME=Drakkar Support
# AGENT_NAME=Support Bot
# TICKET_ORIGIN=https://desk.drakkar.software

# ── request.ts — sealed resource-request round-trip ────────────────────
# BOT_IDENTITY_LINK=https://desk.drakkar.software/request#<token>
# REQUESTER_SPACE_ID=sp-…
# BOT_NAME=Desk Bot
# REQUESTER_NAME=Alice (requester)
# STATELESS=1
```

Typecheck: `node_modules/.bin/tsc -p examples/create-ticket/ts/tsconfig.json`.

---

## Concepts

### Requester invite link — ticket-scoped access (`ticket.ts` owner path)

`createTicket` calls `createNodeInviteLink`, which adds a **per-node** member to the space
roster and returns a `requesterInviteLink`. The external requester opens it, accepts the
per-node invite, and can read/write **only** that ticket room — never other tickets or
channels. The member path can't issue one: `createNodeInviteLink` writes the member roster
(`spaceAccessPush`), which needs the owner's cap — a member cap is denied 403, so the
example falls back to `createTicketNode` (no link).

### Client submission without a REST API (`request.ts`)

The **sealed resource-request inbox** (`submitResourceRequest` / `scanResourceRequests` /
`acceptResourceRequest` / `scanResourceGrants` / `acceptResourceGrant`, from
`@drakkar.software/octospaces-sdk`) lets a requester file a ticket with only the bot's
**public identity link** — no cap, no secret:

```
REQUESTER  submitResourceRequest(botLink, { spaceId, nodeType:'ticket', title, meta, message })
             │ verify link binding + live profile, seal to bot KEM
             └─▶ anonymous append → inbox/{botId}/{shard}
BOT        scanResourceRequests() → acceptResourceRequest({ create: makeTicketCreateHandler() })
             ├─▶ createTicketNode(title, TicketMeta, reqId)   ← dedup by reqId
             ├─▶ inviteToNode() → per-node cap
             └─▶ seal ResourceGrant → inbox/{requesterId}/{shard}
REQUESTER  scanResourceGrants() → acceptResourceGrant()
             └─▶ per-node cap stored → post into the ticket's objinvlog (ticket-scoped only)
```

The bot's space credentials never touch the client; the whole exchange is E2EE.

## Python — not provided (and why)

Same reason as [`dm-via-link`](../dm-via-link#python--not-provided-and-why): ticket node
creation, the `TicketMeta` shape, the per-node invite-link flow, and the stream encryptor all
live in the TypeScript `@drakkar.software/octochat-sdk` and have no Python counterpart.
