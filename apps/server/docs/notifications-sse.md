# Server-side SSE via NATS + Whistlers — implementation plan

> **Status: plan (not implemented).** Wires the existing SSE-driven frontend to a
> real delivery path: the OctoChat Starfish server publishes chat change-events
> to **NATS**; **Whistlers** (`@drakkar.software/whistlers`) consumes NATS and
> serves them to clients as **SSE**. The frontend already consumes SSE
> (`apps/mobile/src/lib/events.ts`); today its `/events` endpoint doesn't exist.

## Architecture

```
client push ─▶ Starfish server (apps/server, Hono :8787)
                   │  afterWrite (queuing plugin, "chat" collection only)
                   ▼
                 NATS  (subject: octochat.chat.changed)   :4222
                   │
                   ▼
               Whistlers  (NatsQueueAdapter → SSEDestination)  :8080 /events
                   │  text/event-stream
                   ▼
            OctoChat clients (EventSource → unread counts)
```

Three deployables: **Starfish server**, **NATS**, **Whistlers**. Only the
Starfish server needs code; NATS + Whistlers are configured/deployed; the
frontend gets a one-line URL change.

Event payload (E2E constraint): the queuing plugin can only publish
`{ collection:"chat", hash, timestamp, params:{ spaceId, roomId } }` — never
message content/author. Counts are per-room; "not my own" stays handled
client-side (the open room isn't counted).

---

## Component 1 — Starfish server → NATS (`apps/server`, code)

1. **Deps** (`apps/server/package.json`): add
   `@drakkar.software/starfish-queuing` as a `link:` to
   `../../../../Drakkar-Software/satellite/packages/ts/queuing` (mirrors the
   existing `starfish-*` links) and `@nats-io/transport-node` (nats.js v3 — the
   same client Whistlers 0.4.1 uses).

2. **`apps/server/src/queue.ts` (new)** — NATS transport via `CustomQueue` (TS has
   no built-in NATS backend):
   ```ts
   import { connect, type NatsConnection } from "@nats-io/transport-node";
   import { CustomQueue, type Queue } from "@drakkar.software/starfish-queuing";

   export async function createNatsQueue(): Promise<{ queue: Queue; nc: NatsConnection | null }> {
     const url = process.env.NATS_URL;
     if (!url) { // dev: run without NATS
       console.warn("[OctoChat] NATS_URL unset — chat change-events disabled.");
       return { queue: new CustomQueue({ onPublish: () => {} }), nc: null };
     }
     const nc = await connect({ servers: url });
     const queue = new CustomQueue({ onPublish: (subject, payload) => { nc.publish(subject, payload); } });
     return { queue, nc };
   }
   ```

3. **`apps/server/src/index.ts`** — register the plugin on the **sync router**
   (NOT the role resolver — `identitiesServerPlugin`/`sharingServerPlugin` stay in
   `createCapCertRoleResolver` where they already are):
   ```ts
   const { queue, nc } = await createNatsQueue();
   const queuing = createQueuingServerPlugin({
     queue,
     collections: { chat: { topic: "octochat.chat.changed", includeParams: true } },
   });

   const syncRouter = createSyncRouter({
     store, config, roleResolver,
     roleEnricher: makeSpaceRoleEnricher(store),
     plugins: [queuing],                 // ← add
   });
   // …
   createGracefulShutdown({ plugins: [queuing] });  // ← was () ; runs queue.close()
   // also drain NATS on shutdown: await nc?.drain()
   ```
   Publish **only `chat`** (keyring/registry/profile writes stay quiet).
   `includeParams:true`, `includeBody:false`.

> **Optional (multi-tenant hardening):** instead of one static subject, derive a
> per-space subject in `onPublish` (parse the JSON, publish to
> `octochat.chat.<spaceId>`). Lets Whistlers/clients subscribe per space. Skip
> for a single-tenant POC.

---

## Component 2 — NATS + Whistlers (deploy/config, no code)

Whistlers ships a stock CLI/Docker server (`@drakkar.software/whistlers`,
`bin/server.ts`) driven by env + a JSON config — no code needed.

**`infra/whistlers.config.json`:**
```json
{
  "version": 1,
  "subscriptions": [
    { "name": "octochat-chat", "topics": ["octochat.chat.changed"], "destinationTopic": "octochat-chat" }
  ]
}
```

**`docker-compose.yml` (dev):**
```yaml
services:
  nats:
    image: nats:2
    ports: ["4222:4222"]
  whistlers:
    image: ghcr.io/drakkar-software/whistlers:latest   # or build from the repo
    depends_on: [nats]
    environment:
      QUEUE_TYPE: nats
      QUEUE_URL: nats://nats:4222
      DESTINATION_TYPE: sse
      SSE_PORT: "8080"
      SSE_PATH: /events
    ports: ["8080:8080"]
    volumes: ["./infra/whistlers.config.json:/etc/whistlers/config.json:ro"]
```
Run the Starfish server with `NATS_URL=nats://localhost:4222`. (Prod: Whistlers
has an Ansible/systemd role; same env.)

**SSE payload shape:** Whistlers' default SSE `data:` is an envelope
`{ topic, sourceTopic, notification, data, rawPayload }` — the Starfish
`QueueMessage` lands under **`rawPayload`** (`rawPayload.params.roomId`). Handled
in Component 3 by making the parser tolerant.

---

## Component 3 — Point the frontend SSE client at Whistlers (`apps/mobile`)

The SSE endpoint now lives on Whistlers (`:8080`), not the Starfish server.

1. **`src/lib/starfish/config.ts`** — add:
   ```ts
   export const EVENTS_URL = process.env.EXPO_PUBLIC_EVENTS_URL ?? "http://localhost:8080/events";
   ```
2. **`src/lib/events.ts` / `events.native.ts`** — connect to `EVENTS_URL`
   (instead of `${SYNC_BASE}/events`).
3. **`src/lib/events.shared.ts` `parseRoomChange`** — accept both the Whistlers
   envelope and a raw `QueueMessage`:
   ```ts
   const d = JSON.parse(data);
   const params = d.params ?? d.rawPayload?.params;   // raw OR Whistlers envelope
   const roomId = params?.roomId;
   ```
   Everything downstream (unread counts, badges, notifications screen) is
   unchanged.

> **Optional:** connect to `/events?topic=octochat-chat` to filter at the
> gateway (Whistlers sanitizes `destinationTopic`), and/or use per-space subjects
> from Component 1's hardening note.

---

## Optional follow-on — open-room live messages over SSE

`useRoom` still pulls the open room every 4 s for live messages. Once SSE is
live, replace that timer with a pull triggered by an SSE event for the open room
(`event.roomId === roomId → store.pull()`), completing "rely on SSE, never poll."
Scoped separately — confirm before doing it.

---

## Verification

1. `docker compose up` (NATS + Whistlers); start the Starfish server with
   `NATS_URL=nats://localhost:4222`.
2. `nats sub "octochat.chat.>"` → send a message in the app → one
   `{collection:"chat",…,params:{spaceId,roomId}}` per push; none on keyring/registry writes.
3. `curl -N "http://localhost:8080/events"` → see `data: {…}` frames + `:keep-alive`.
4. In the app (second identity/tab), a message to a room you're not viewing
   increments that room's badge, its space monogram, the bell, and the tab badge;
   your own open room doesn't increment; counts persist across reload.
5. With `NATS_URL` unset the Starfish server still boots (no-op queue).
6. `pnpm typecheck` clean.
```
