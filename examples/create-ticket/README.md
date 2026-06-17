# OctoDesk — submit a ticket request

A **fresh, non-member** identity files a sealed **ticket request** into a space it doesn't belong
to, using **only the space owner's public identity link** — no cap, no secret, no membership. The
owner accepts it on their side, in the OctoChat app.

```
REQUESTER (fresh identity; holds only the owner's public link)
  submitResourceRequest(ownerLink, { spaceId, nodeType:'ticket', title, meta, message })
    │  verify link binding + cross-check the owner's live profile
    │  seal the request to the owner's KEM key
    └─▶ anonymous append → inbox/{ownerId}/{shard}          (public-write — no cap needed)

OWNER (in the OctoChat app — see "What the owner sees")
  Incoming requests handling (per space): review manually · auto-accept · auto-accept & reply
    └─▶ a ticket in the space (the requester gets ticket-scoped access only)
```

The owner's space credentials never touch the requester; the request is sealed end-to-end. There
is exactly one script — `submit-ticket.ts` (the requester half). Acceptance happens in the app.

## Run

Build the SDK, then submit using the **request link** the owner copies from their space
(OctoChat → space **Settings → Requests → Copy link**). One link carries both the owner identity
and the target space:

```bash
pnpm --filter @drakkar.software/octochat-sdk build
REQUEST_LINK="https://desk.drakkar.software/request?s=sp-48521ba9…#<token>" \
STARFISH_URL=https://dev-sync.drakkar.software/sync STARFISH_NAMESPACE=octospaces \
  node_modules/.bin/tsx examples/create-ticket/ts/src/submit-ticket.ts
# or, from examples/create-ticket/ts/ :  pnpm start
```

You'll see `submitted ✓ reqId=…`. The request now sits sealed in the owner's inbox.

### Where does the link come from?

It's the **owner's**, and **not a secret**. The request link is `…/request?s=<spaceId>#<token>` —
a public identity link (`#<token>`, the same v:2 format as a "DM me" link, safe to publish/QR) plus
the target space (`?s=`). Use the one combined `REQUEST_LINK`, or pass the parts separately:

| Var | Default | Meaning |
| --- | --- | --- |
| `REQUEST_LINK` | *(preferred)* | Combined `…/request?s=<spaceId>#<token>` from the space's Requests card — supplies BOTH the owner identity and the target space. |
| `OWNER_LINK` | *(alt.)* | The owner's public identity link (`…#<token>` or bare token) — used with `SPACE_ID` when no `REQUEST_LINK`. |
| `SPACE_ID` | *(alt.)* | The space to file into (a bare identity link doesn't encode it). |
| `STARFISH_URL` | `http://localhost:8787` | Sync server base URL. Must match the owner's. |
| `STARFISH_NAMESPACE` | *(empty)* | Deployed namespace (e.g. `octospaces`); empty for local. |
| `TICKET_TITLE` · `TICKET_REQUESTER` · `TICKET_MESSAGE` | demo values | Ticket subject, requester field, and body. |
| `REQUESTER_NAME` | `Alice (requester)` | Display name for the fresh requester identity. |

## What the owner sees

Acceptance lives in the OctoChat app, configurable **per space** under **Settings → Requests**
(shown only on a desk-capable build):

- **Review manually** (default) — the request appears under **Requests** to **Accept** or
  **Decline**.
- **Auto-accept** — it becomes a ticket on the owner's next app open.
- **Auto-accept and reply** — it becomes a ticket with a first reply already posted (AI-written, or
  a fixed message the owner set).

> The app must run a variant whose features include `tickets` (the default `octochat` does not).
> Launch it with `EXPO_PUBLIC_VARIANT=octodesk` (or `octopulse`), signed in as the space owner.

## Configure (`.env`)

The script loads `examples/create-ticket/.env`:

```bash
cp examples/create-ticket/.env.example examples/create-ticket/.env
# then edit examples/create-ticket/.env
```

`.env.example` layout:

```env
# Sync server — must match the owner's app.
STARFISH_URL=https://dev-sync.drakkar.software/sync
STARFISH_NAMESPACE=octospaces

# Preferred: the combined request link from the space's Requests card (identity + space, no secret).
REQUEST_LINK=https://desk.drakkar.software/request?s=sp-…#<token>

# Alternative to REQUEST_LINK: the owner's public identity link + the space, passed separately.
# OWNER_LINK=https://desk.drakkar.software/request#<token>
# SPACE_ID=sp-…

# Optional ticket fields.
# TICKET_TITLE=Login fails on Safari 17
# TICKET_REQUESTER=alice@example.com
# TICKET_MESSAGE=Safari 17.4 on macOS 14.5 returns 403 on /api/login.
# REQUESTER_NAME=Alice (requester)
```

Typecheck: `node_modules/.bin/tsc -p examples/create-ticket/ts/tsconfig.json`.

## Python — not provided (and why)

Same reason as [`dm-via-link`](../dm-via-link#python--not-provided-and-why): the sealed
resource-request flow (`submitResourceRequest`), the identity-link verification, and the KEM seal
all live in the TypeScript `@drakkar.software/octochat-sdk` and have no Python counterpart.
