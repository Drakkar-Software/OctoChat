# Server-side spec — chat change-events to NATS (notifications)

> **Status:** design / handoff spec. **Not yet implemented in `apps/server`.**
> The frontend unread-counter + notifications work ships independently and does
> not depend on this — it computes unread client-side. This document is the plan
> for the server half: emit a change-event on every message push so other space
> members can be notified (real-time, and later OS push).

## Goal

After a member pushes a message, publish a lightweight change-event to **NATS**.
A separate process binds NATS → **Firebase** for real-time fan-out and OS push
(out of scope here — owned by the delivery infra).

## Mechanism: the Starfish queuing plugin

`@drakkar.software/starfish-queuing` is a **server-side** `ServerPlugin`. After
each successful push the server hands it a `WriteEvent`; for any collection in
its `collections` map it publishes a `QueueMessage` to a `Queue` transport.

```ts
// QueueMessage (UTF-8 JSON on the wire)
interface QueueMessage {
  collection: string;            // "chat"
  hash: string;                  // SHA-256 of the stored doc
  timestamp: number;             // ms since epoch
  params?: Record<string, string>; // { spaceId, roomId } when includeParams
  body?: Record<string, unknown>;  // omitted (see below)
}
```

Verified against satellite `packages/ts/queuing` (v3). The TS package exports
`Queue`, `QueueMessage`, `MemoryQueue`, `CustomQueue`, `QueueConfig`,
`coerceQueue`, `createQueuingServerPlugin`. **There is no built-in NATS backend
in TS** (`NatsQueue` is Python-only) — wrap the `nats` npm client in
`CustomQueue`, or implement the one-method `Queue` interface directly (the
pattern used in satellite's own `queuing/tests/plugin.test.ts`).

## What to publish

- **Only the `chat` collection.** Its `storagePath` is
  `spaces/{spaceId}/chat/rooms/{roomId}`, so with `includeParams: true` the event
  carries `params: { spaceId, roomId }`. Keyring / member / registry writes stay
  quiet (don't add them to the map).
- **`includeBody: false`.** The `chat` collection is `encryption: "delegated"` —
  the body is opaque ciphertext (useless server-side) and a metadata leak. Send
  IDs only.
- **No pusher identity** exists in `WriteEvent`. "Don't notify the author" is
  filtered **client-side** after decrypt (the app already excludes
  `authorId === session.userId`). The server cannot and must not try to know who
  sent it.

## Wiring (`apps/server`)

1. **Deps** — add to `apps/server/package.json`:
   - `@drakkar.software/starfish-queuing` as a `link:` to
     `../../../../Drakkar-Software/satellite/packages/ts/queuing` (mirror the
     other `starfish-*` links).
   - `nats` (npm client).

2. **`apps/server/src/queue.ts` (new)** — build the transport:

   ```ts
   import { connect, type NatsConnection } from "nats";
   import { CustomQueue, type Queue } from "@drakkar.software/starfish-queuing";

   // Returns a queue + its NatsConnection (null in dev). Re-publishes per-space
   // so the NATS→Firebase bind can subscribe to `octochat.chat.<spaceId>`.
   export async function createNatsQueue(): Promise<{ queue: Queue; nc: NatsConnection | null }> {
     const url = process.env.NATS_URL;
     if (!url) {
       console.warn("[OctoChat] NATS_URL unset — chat change-events disabled (dev).");
       return { queue: new CustomQueue({ onPublish: () => {} }), nc: null };
     }
     const nc = await connect({ servers: url });
     const queue = new CustomQueue({
       onPublish: (subject, payload) => {
         // Base subject from QueueConfig.topic; also fan out per space.
         try {
           const msg = JSON.parse(new TextDecoder().decode(payload)) as { params?: { spaceId?: string } };
           const spaceId = msg.params?.spaceId;
           if (spaceId) nc.publish(`${subject}.${spaceId}`, payload);
         } catch { /* fall through to base subject */ }
         nc.publish(subject, payload);
       },
     });
     return { queue, nc };
   }
   ```

3. **`apps/server/src/index.ts`** — register the plugin and close it on shutdown:

   ```ts
   import { createQueuingServerPlugin } from "@drakkar.software/starfish-queuing";
   import { createNatsQueue } from "./queue.js";

   const { queue, nc } = await createNatsQueue();
   const queuing = createQueuingServerPlugin({
     queue,
     collections: { chat: { topic: "octochat.chat.changed", includeParams: true } },
   });

   const syncRouter = createSyncRouter({
     store,
     config,
     roleResolver,
     roleEnricher: makeSpaceRoleEnricher(store),
     plugins: [queuing],            // ← add
   });

   // …
   createGracefulShutdown({ plugins: [queuing] }); // ← was createGracefulShutdown()
   // The plugin's shutdown hook calls queue.close(); also `await nc?.drain()`.
   ```

   `CustomQueue` has no `close()`, so to drain NATS either pass a `Queue` whose
   `close()` calls `nc.drain()`, or drain `nc` in your own shutdown handler.

## Subjects

- Base: `octochat.chat.changed` (from `QueueConfig.topic`).
- Per-space fan-out: `octochat.chat.changed.<spaceId>` (added in `onPublish`).
  The NATS→Firebase bridge subscribes per space and maps `{ spaceId, roomId }` →
  the space's members → their Firebase topics / FCM tokens.

## Client seam (already built in the app)

The app's unread provider exposes `noteRoomChanged(roomId)`. When the
NATS→Firebase delivery lands, the Firebase subscription handler calls
`noteRoomChanged(roomId)` (derive `roomId` from the event `params`) to update
unread badges in real time. Until then the app polls (~20 s) — drop the poll
once push delivery is live.

## Deferred (not this spec)

OS push (Expo Push / FCM token registry + the worker that consumes NATS and
sends pushes), the NATS→Firebase binding itself, and any per-recipient routing.

## Verify

```sh
docker run -p 4222:4222 nats
NATS_URL=nats://localhost:4222 pnpm --filter @octochat/server dev
nats sub "octochat.chat.>"     # then send a message in the app
# expect: {"collection":"chat","hash":"…","timestamp":…,"params":{"spaceId":"sp-…","roomId":"sp-…-general"}}
# expect: NO events on keyring / room-registry / profile writes
```
With `NATS_URL` unset the server still boots; no events publish.
