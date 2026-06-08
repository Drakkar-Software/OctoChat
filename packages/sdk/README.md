# @drakkar.software/octochat-sdk

The **headless, reusable OctoChat core** — all of OctoChat's chat logic with no UI,
no React, no platform lock-in. Wire any frontend (web, native, desktop, a bot) to the
same end-to-end-encrypted backend (a [Starfish](https://github.com/Drakkar-Software/Starfish)
sync server) by importing this package.

## What's inside

- **Identity & crypto** — BIP-39 seed → Ed25519/Kyber device keys, sealed-credential
  envelopes, per-space keyring encryptors, device pairing, session restore.
- **Encrypted sync** — the Starfish client + auth signing, the spaces/rooms registry,
  the object tree (`objects`/`object-index`), offline read-through caches.
- **Spaces / rooms / members / DMs / public spaces** — membership, member caps,
  invite links, DM channels, public-space join, attachments, stream bots.
- **Messages & domain** — message-body/markdown parsing, reactions, threads,
  read-marks & mutes (synced prefs), notification formatting, the live change-event
  SSE subscriber, automations core, and the chat-domain type model.

It depends on the published `@drakkar.software/starfish-*` packages and is framework-
and platform-agnostic.

## Source layout

`src/` is grouped by subject (everything is re-exported from `src/index.ts`):

- `config/` — host wiring (`configureOctoChat`/`configureKv`) and platform adapters
- `domain/` — core model: types, ids, the object-type registry
- `format/` — pure formatters & view models (message body, markdown, message view)
- `starfish/` — encrypted sync / crypto / registry core (identity, client, keyrings, objects, DMs, public spaces)
- `messaging/` — reads, mutes, reactions, threads, links, cross-room, quick-reactions
- `notifications/` — notification formatting, labels, previews
- `outbox/` — offline write queue
- `spaces/` — space stats + public-space exploration
- `events/` — live room-change SSE stream
- `nostr/` — NIP-07 browser-extension login
- `automations/` — scheduled/triggered room automations (+ providers)

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
present; on React Native install `react-native-quick-crypto` at boot.

## Reference consumer

The OctoChat Expo app (`apps/mobile`) is a full reference frontend: it injects its
platform `kv`/config in `src/lib/octochat-init.ts` and consumes the SDK from its React
hooks and context providers. The platform-branched pieces (`kv`/`storage`/`platform`/
`passkey`) and all React live in the app — never in this package.
