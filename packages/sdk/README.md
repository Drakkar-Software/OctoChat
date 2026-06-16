# @drakkar.software/octochat-sdk

The **headless, reusable OctoChat core** — all of OctoChat's chat logic with no UI and
no React. Wire any frontend (web, native, desktop, a bot) to the same
end-to-end-encrypted backend (a [Starfish](https://github.com/Drakkar-Software/Starfish)
sync server) by importing this package.

The default entry (`.`) is **platform-agnostic and dependency-free** (only Starfish +
pure-crypto deps). Ready-made platform adapters (kv, the seed vault, passkeys, the
crypto install) ship behind an **optional subpath** `@drakkar.software/octochat-sdk/platform`
with `.native`/web branches and optional React-Native peer deps — opt in to reuse them,
or inject your own via `configureKv` and keep the core platform-neutral.

## What's inside

- **Identity & crypto** — BIP-39 seed → Ed25519/Kyber device keys, sealed-credential
  envelopes, space keyrings (one CEK per space), device pairing, session restore.
- **Encrypted sync** — the Starfish client + auth signing, the spaces/rooms registry
  (`spaceregistry`/`_access`), the object tree (`objects`/`object-index`), offline
  read-through caches.
- **Spaces / rooms / members / DMs / per-node access** — membership, invite links
  (space-wide and per-node), DM channels, space join via link, attachments, stream bots.
  Room access is **per-node** (`access ∈ {public, space, invite}` + `enc` boolean);
  re-exports `getNodeAccess`, `buildNodeAccess`, `createNode`, `joinSpaceByLink`,
  `joinNodeByLink`, `createSpaceInviteLink`, and the full space-access store from
  `@drakkar.software/octospaces-sdk`.
- **Messages & domain** — message-body/markdown parsing, reactions, threads,
  read-marks & mutes (synced prefs), notification formatting, the live change-event
  SSE subscriber, automations core, and the chat-domain type model.

It depends on the published `@drakkar.software/starfish-*` packages and on
`@drakkar.software/octospaces-sdk` (which it re-exports for per-node access,
space invite links, node creation, and the space-access store). Framework- and
platform-agnostic.

## Source layout

`src/` is grouped by subject (everything is re-exported from `src/index.ts`):

- `config/` — host wiring (`configureOctoChat`/`configureKv`)
- `domain/` — core model: types, ids, the object-type registry
- `format/` — pure formatters & view models (message body, markdown, message view)
- `starfish/` — encrypted sync / crypto / registry core (identity, client, keyrings, objects, DMs, per-node access)
- `messaging/` — reads, mutes, reactions, threads, links, cross-room, quick-reactions
- `notifications/` — notification formatting, labels, previews
- `outbox/` — offline write queue
- `spaces/` — space stats + space directory exploration
- `events/` — live room-change SSE stream
- `nostr/` — NIP-07 browser-extension login
- `automations/` — scheduled/triggered room automations (+ providers)
- `platform/` — **optional** platform adapters (kv, vault, passkey, crypto install),
  `.native`/web branched, exposed as the `./platform` subpath — NOT part of the
  default `.` entry, so the core stays dependency-free

The default entry (`.`) imports nothing from `platform/`; the React-Native peer deps
(`expo-secure-store`, `@react-native-async-storage/async-storage`,
`react-native-quick-crypto`) are declared **optional** and only pulled when a host
imports the `./platform` subpath.

## Wiring it up

The SDK does not read environment variables or bind to a storage backend — the host
supplies those once at boot:

```ts
import { configureOctoChat, configureKv } from '@drakkar.software/octochat-sdk';

configureOctoChat({
  syncBase: 'https://sync.example.com',  // Starfish server
  syncNamespace: 'octochat',             // optional; '' for a root-mounted dev server
  // eventsUrl, webBase optional
});

configureKv({                            // any async key/value store
  get: (k) => storage.getItem(k),
  set: (k, v) => storage.setItem(k, v),
  remove: (k) => storage.removeItem(k),
});
```

Then use the domain APIs directly — e.g. derive a session from a seed, open a space's
encryptor, read/write the registry, subscribe to live room changes:

```ts
import { deriveSession, subscribeRoomChanges, buildAuthHeaders } from '@drakkar.software/octochat-sdk';

const session = await deriveSession(seedWords);
const stop = subscribeRoomChanges(onChange, { spaces, authHeaders });
```

Global `fetch` and WebCrypto (`crypto.subtle` / `getRandomValues`) are assumed to be
present. You can supply the storage/crypto wiring yourself, or opt into the ready-made
adapters from the optional subpath:

```ts
import {
  kvGet, kvSet, kvRemove,    // localStorage (web) / AsyncStorage (native)
  configureStarfishPlatform, // installs react-native-quick-crypto on native
  loadVault, unlockVault,    // PIN/passkey (web) or secure-store (native) seed vault
} from '@drakkar.software/octochat-sdk/platform';

configureStarfishPlatform();
configureKv({ get: kvGet, set: kvSet, remove: kvRemove });
```

## Desk / tickets

OctoDesk tickets are `access:'invite'` object nodes created by `createTicket`
(`src/desk/orchestrator.ts`). Every ticket **isolates** the external requester to their
own node — never the desk space index or other tickets:

- **Plaintext ticket** (`memberTicket:false`, default) — per-node content + stream caps,
  cap-gated server-side; messages stored plaintext. Every space member (agents/owner/bot)
  reads+writes via the `space:member` role (shared support-queue model); the requester
  reaches only their node via per-node caps.
- **E2EE ticket** (`memberTicket:true`) — the ticket gets its OWN **per-node keyring**
  (octospaces-sdk ≥0.12.6): the content key is wrapped only to the ticket's participants
  (requester + owner/bot, plus agents on assignment). The requester decrypts via that
  keyring **without ever holding the space-wide key** and without space membership.
  Messages are sealed client-side and stored in the cap-gated invite stream (`objinvlog`).

Both tiers route reads/writes through the invite stream: `outbox-send.ts` (queued send) and
`use-room` / `use-room-open-flow` (live) pass the node's `access` to `buildNodeAccess` so the
SDK opens the per-node keyring for `invite+enc`, and append via `getNodeStreamClient`.

> Recipient model: E2EE tickets are **least-privilege** — only the requester + owner/bot are
> recipients at creation; an agent is added to the node keyring when the ticket is assigned to
> them (so unassigned agents cannot read an E2EE ticket until assignment).

**Revocation:** `revokeTicketAgent(session, spaceId, ticketId, agentUserId)` rotates the
ticket's per-node keyring so a removed agent can no longer decrypt FUTURE messages (forward
secrecy only — already-seen messages can't be un-seen). Use it when unassigning/off-boarding
an agent from an encrypted ticket; the caller must hold the keyring (the desk owner/bot).

## Reference consumer

The OctoChat Expo app (`apps/mobile`) is a full reference frontend: it wires the SDK at
boot in `src/lib/octochat-init.ts` (env → `configureOctoChat`, plus `configureKv` fed
from the `./platform` kv adapter) and consumes the domain APIs from its React hooks and
context providers. All React lives in the app; the platform adapters now live in this
package's optional `./platform` subpath.
