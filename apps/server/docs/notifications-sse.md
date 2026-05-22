# Server-side SSE via NATS + Whistlers

Real-time delivery path for chat change notifications. The OctoChat Starfish
server publishes chat change-events to **NATS**; **Whistlers**
(`@drakkar.software/whistlers`) consumes NATS and serves them as **SSE**;
an authenticated proxy on the Starfish server gates the stream per-caller.

## Architecture

```
client push ─▶ Starfish server (apps/server, Hono :8787)
                   │  afterWrite — queuing plugin, "chat" collection only
                   │  subject: octochat.chat.changed.<spaceId>
                   ▼
                 NATS                                          :4222
                   │
                   ▼
               Whistlers  (NatsQueueAdapter → SSEDestination) :8080/events
               namespace "octochat" → topic:
               octochat-octochat-chat-changed-<spaceId>
                   │  text/event-stream (internal, not client-facing)
                   ▼
            Starfish /events proxy (events.ts)
               • verifies cap-cert + Ed25519 request signature
               • validates caller membership for each ?spaces= id
               • reconstructs namespaced ?topic= filters server-side
               • proxies only the authorized topics upstream
                   │
                   ▼
            OctoChat clients (fetch SSE → unread counts / live messages)
```

Three deployables: **Starfish server** (`:8787`), **NATS** (`:4222`),
**Whistlers** (`:8080`). Clients connect to the Starfish server only; the
internal Whistlers endpoint is never exposed directly.

---

## Dev setup

### 1. NATS

```
docker compose up nats
```

Or keep it running via the full `docker compose up`.

### 2. Whistlers (SSE gateway)

Whistlers ships as an npm package. A custom launcher (`infra/whistlers-sse.mjs`)
wraps it with CORS headers (needed because the browser app on :8081 connects
cross-origin to :8080 in dev, whereas the prod path goes through the Starfish
proxy).

```
QUEUE_URL=nats://localhost:4222 node infra/whistlers-sse.mjs
```

> **Restart required.** Whistlers loads `infra/whistlers.config.json` and the
> npm package **once at startup** — it does not watch for changes. Restart the
> process any time you change the config file or update the package.

Config lives at `infra/whistlers.config.json` (mounted into the Docker service
as `/etc/whistlers/config.json`):

```json
{
  "version": 1,
  "subscriptions": [],
  "namespaces": {
    "octochat": {
      "subscriptions": [
        { "name": "octochat-chat", "topics": ["octochat.chat.changed.*"] }
      ]
    }
  }
}
```

The `octochat` namespace prefixes every destination topic with `octochat-`,
producing `octochat-octochat-chat-changed-<spaceId>`. The Starfish proxy
(`apps/server/src/events.ts`, constant `WHISTLERS_NAMESPACE`) reconstructs the
same prefix when building `?topic=` filters — the two must stay in sync.

### 3. Starfish server

```
NATS_URL=nats://localhost:4222 pnpm --filter @octochat/server dev
```

With `NATS_URL` unset the server boots normally; chat events are silently
dropped (no-op queue).

---

## Verification

1. Start all three: NATS, Whistlers, Starfish server (see above).

2. Confirm Whistlers subscribes and emits:
   ```
   # terminal 1 — subscribe (should stream a namespaced event)
   curl -N "http://localhost:8080/events?topic=octochat-octochat-chat-changed-sp-<id>"

   # terminal 2 — publish a fake NATS message
   node -e "
   import('@nats-io/transport-node').then(async ({connect}) => {
     const nc = await connect({ servers: 'nats://localhost:4222' });
     nc.publish('octochat.chat.changed.sp-<id>',
       new TextEncoder().encode(JSON.stringify({spaceId:'sp-<id>',roomId:'room-x'})));
     await nc.drain();
   });"
   ```
   Expect a `data: {"topic":"octochat-octochat-chat-changed-sp-<id>", ...}` frame.

3. In the app (two tabs / identities): send a message to a room you are not
   viewing → the unread badge increments; your own open room does not increment;
   counts survive a reload.

4. `pnpm typecheck` clean.

---

## Whistlers package

`@drakkar.software/whistlers` is declared as a root-level npm dependency
(`package.json`) so Node can resolve it from `infra/whistlers-sse.mjs`. With
pnpm's `nodeLinker: hoisted` it lands in root `node_modules` alongside its
transitive deps (including `@nats-io/transport-node`).

To test local Whistlers changes against OctoChat, use `pnpm link` instead of
editing the hardcoded path — the path-based approach was intentionally removed.
