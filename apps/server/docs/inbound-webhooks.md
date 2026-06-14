# Inbound webhooks → rooms (self-service)

Let an external system (CI, an alerting pipeline, a no-code automation, …) POST a
message that lands in a room — no OctoChat account. Webhooks are **self-service**: a
space **owner** mints their own from the app, with their own token. There is no shared
secret and no per-webhook operator config.

Implemented in [`apps/server/src/webhook.ts`](../src/webhook.ts) (server),
`packages/sdk/src/starfish/webhooks.ts` (provisioning), and the app's `WebhookPanel`.

## How it works

1. A space owner opens the room's **Incoming webhooks** panel and taps *Create
   webhook*. The app generates a high-entropy token and writes a registry doc
   `spaces/{spaceId}/_webhooks` (collection `webhooks`, gated `space:owner`)
   mapping `webhookId → { tokenHash, roomId, label, … }`. **Only the SHA-256 of the
   token is stored** — the raw token is shown once and never persisted.
2. The owner pastes the **URL + token** into their external tool.
3. The tool POSTs; the server reads the registry in-process, hashes the presented
   token, compares it to the stored hash, and appends the message to the room.

## Request

```
POST /webhook/{spaceId}/{webhookId}
Content-Type: application/json
X-Webhook-Token: <the token shown once at creation>

{ "text": "build #4213 passed ✅", "author": "ci-bot" }
```

The body is **provider-neutral**: `text` (required) + optional `author` display name.
OctoChat ships no Slack/Discord/GitHub adapters — translate to `{ text, author? }` in
front if needed. `author` is **untrusted**: it is sanitized and stored as
`authorId: "webhook:<name>"`, namespaced so it can never impersonate a real account.

Responses: `200 { ok, timestamp }`; `401` missing/wrong token; `400` bad path / missing
`text` / invalid JSON; `413` body > 64 KB; `404` unknown webhook; `409` append conflict.

The token is a **bearer credential** (like a Slack incoming-webhook URL): treat it like
a password, send it only over TLS. It cannot be recovered — to rotate, create a new one
and revoke the old. Revoking removes its hash, so the token can never be used again.

## Operator setup

**None.** There is no platform secret and no operator-configured signing key. The
feature is always on; it only does anything for a room once its owner has minted a
webhook. Each webhook's append-author signing key is **derived from its token**
(`seed = SHA-256("octochat-webhook-sign\n" ‖ token)`, used as an Ed25519 seed), so the
server re-derives it at POST time from the presented token and signs the append — no
key is configured, and no signing private key is stored anywhere (only the token hash
and the signing *public* key live in the registry).

## Security model

- **No shared/platform secret.** Each webhook has its own user-crafted token; the
  server stores only its hash and the derived signing *public* key. A storage compromise
  leaks no usable token and no signing private key (both are token-derived / hashed).
- **Token is the single root secret.** Only the holder of the token (the legitimate
  caller) — or the server transiently, when handed it — can produce a valid author
  proof, because the signing key is derived from the token.
- **Server-trusted ingress.** The target room comes from the owner-written registry
  (`spaces/{spaceId}/_webhooks`, gated `space:owner`), never from the caller. Path
  segments are charset-validated before any store key is built (no traversal). The
  append goes to `streampub` (`spaces/{spaceId}/streams/pub/{roomId}`) and is published
  on `octochat.chat.changed` so SSE delivers it live.
- **Replay.** A bearer token travels in each request, so a captured request can be
  replayed within the reach of whoever captured it — the same model as Slack/Discord
  incoming webhooks. TLS is required; impact is bounded (a public room, the append
  `maxItems` cap). Rotate the token if you suspect exposure.
- **Rate-limit** the public `/webhook/*` path at your edge. The route reads the
  (bounded) registry before the token check — inherent, since the stored hash is needed
  to verify — but the body is capped first and the registry is small.
- **Bounded fan-out.** Webhooks are capped per space (`MAX_WEBHOOKS_PER_SPACE`), and id
  segments are restricted to a strict charset (no `.`), so they can't inject extra NATS
  subject tokens.

## End-to-end-encrypted ("sealed") webhooks — optional

To accept webhook posts into a room where the **server must not see the content**,
store a published **space write key** (X25519 public, hex) on the webhook entry
(`sealKemPubHex`, via `createWebhook({ …, sealKemPubHex })`). The server then seals each
message to that key before storage, so a plaintext collection holds only ciphertext.

- The webhook can inject a message but never read the room (it holds only the space
  write *public* key; the per-message seal is signed with the webhook's token-derived
  key).
- **Members** hold the matching private key (distributed out of band) and open messages
  with the SDK helpers (`openSealedItems` / `openSealedStreamElement`), pinning
  `requireSealer` to the webhook's signing public key — surfaced as `signerPubHex` from
  `createWebhook` / `listWebhooks`.

The encryption boundary is the **server receiver**: it seals at ingest, and from there
storage/SSE carry ciphertext only. See the Starfish guide
`docs/ts/webhook/02-sealed-write.md` for the full crypto rationale.
