# Append-only rooms & bot integrations

All OctoChat rooms use an **append-only log** for storage: posting is a single signed
`POST /push` with **no pull → merge → push** cycle, no hash, and no conflict handling.
That makes "fire a message from a script/cron/CI step" a single HTTP call, which is the
whole point of bot/webhook integrations.

Room **access** is configured **per-room** (not per-space). When you create a room you
choose:

| `access` value | Collection | Encryption | Who reads | Who writes |
|---|---|---|---|---|
| `'space'` (default) | `streamchat` | `delegated` (E2EE keyring) | space members | space members |
| `'public'` | `streampub` | `none` (plaintext) | everyone | space members |
| `'invite'` (enc: false) | `streaminv` | `none` (plaintext) | per-node cap | per-node cap |

Storage paths (as declared in `apps/server/src/config.ts`):

| Collection | Storage path | Notes |
|---|---|---|
| `streamchat` | `spaces/{spaceId}/streams/{roomId}` | E2EE, sealed per-space keyring |
| `streampub` | `spaces/{spaceId}/streams/pub/{roomId}` | Plaintext, bot-friendly |
| `streaminv` | `spaces/{spaceId}/streams/n/{roomId}/log` | Plaintext, per-node cap access |

All three collections are registered on the `octospaces.log.changed` queue topic (the
`streamchat`/`streampub`/`streaminv` names above are the SDK-side aliases for the unified
`objlog`/`objpublog`/`objinvlog` collections), so an append fires the same per-space SSE
notification a normal message does — readers see bot posts live. **No new nginx route is
needed**: `append` reuses the `/push/` action.

> **Live delivery is gated on the `_access` roster, not the member cap.** The `/events`
> SSE proxy and the FCM bridge authorize a space ONLY for callers named in
> `spaces/{spaceId}/_access.{owner,members}` — the strict, no-TOFU space-role enricher;
> the member cap that satisfies message *reads* is deliberately ignored here. So a space
> must list **every** participant in `_access.members` to receive live notifications +
> unread, even though reads work from the cap alone. This bit DMs: a DM whose peer was
> missing from the roster loaded history but got no live notifications/unread. DMs now seed
> the peer into the roster at creation (`createDmSpaceCore`), and `healDmRosters` (run on
> reconcile) repairs DMs created earlier — only the space owner may write `_access`, so
> each side heals the DMs it owns.

## The element format (what the app renders)

A room log carries three kinds of event, each a tagged envelope:

```jsonc
// t = 'msg' | 'reaction' | 'edit';  e = the payload
{ "t": "msg",      "e": { "id": "...", "authorId": "<hex userId>", "ts": 1716, "text": "Build #42 passed ✅" } }
{ "t": "reaction", "e": { "id": "...", "msgId": "...", "emoji": "🎉", "userId": "...", "kind": "add", "ts": 1716 } }
{ "t": "edit",     "e": { "id": "...", "msgId": "...", "userId": "...", "kind": "edit", "text": "...", "ts": 1716 } }
```

A bot that just posts messages only ever sends `{ t: 'msg', e: { … } }`. `authorId`
is the display author; set it to the bot's own user id (`sha256(edPub)[:32]`, hex) so
posts attribute to the bot.

The server wraps each append as `{ ts, data }`; `data` is the envelope above for a
public room, or the **sealed** envelope for a private (E2EE) room.

---

## Bots on a PUBLIC (plaintext) room

The credential is a Starfish **public link** — an `audience` cap minted with
`createStreamBotCredential`. It carries **no private key**: the bot generates its own
keypair and signs each request with it (`X-Starfish-Pub`). Optional allow‑list + TTL.

### 1. Owner mints the link

In the room, open **Connect a bot → Generate bot link**. It calls
`createStreamBotCredential` (`packages/sdk/src/starfish/stream-bots.ts`) and shows:

- **Bot link token** — the audience‑cap fragment (paste into the bot).
- **Append endpoint (POST)** — the full URL the bot POSTs to.
- **Path to sign** — the path the request signature is bound to (on the deployed
  server this is the `/v1/octochat/push/…` path **without** the external `/sync`
  mount, which nginx strips; locally it equals the endpoint's path).

### 2. Bot redeems and appends

The bot generates a keypair once (the owner may pin it via `allowedIdentities`), then
for each event: build the body, `redeemPublicLink` to sign **this** request with the
bot's key, and POST.

```ts
// bot.ts — Node 20+, deps: @drakkar.software/starfish-{sharing,identities}
import { generateDeviceKeys } from "@drakkar.software/starfish-identities";
import { parsePublicLink, redeemPublicLink } from "@drakkar.software/starfish-sharing";

// --- one-time: the bot's own identity (keep edPriv secret; share edPub if pinned) ---
const bot = generateDeviceKeys(); // { edPub, edPriv, kemPub, kemPriv }
const botUserId = await userIdFromPubHex(bot.edPub); // helper below

// --- from the "Connect a bot" panel ---
const TOKEN     = "PASTE_BOT_LINK_TOKEN";
const ENDPOINT  = "https://<host>/sync/v1/octochat/push/spaces/<spaceId>/streams/pub/<roomId>";
const SIGN_PATH = "/v1/octochat/push/spaces/<spaceId>/streams/pub/<roomId>"; // "Path to sign"
const HOST      = new URL(ENDPOINT).host;

const parsed = parsePublicLink(TOKEN); // structural check; server verifies sig + expiry

export async function postMessage(text: string): Promise<void> {
  const element = { t: "msg", e: { id: crypto.randomUUID(), authorId: botUserId, ts: Date.now(), text } };
  // The append body the OctoChat server/app expects: { data: <element> }.
  const body = JSON.stringify({ data: element });

  // Sign THIS request (fresh ts + nonce each call) with the bot's own key.
  const headers = await redeemPublicLink(parsed, {
    redeemerEdPrivHex: bot.edPriv,
    redeemerEdPubHex: bot.edPub,
    method: "POST",
    pathAndQuery: SIGN_PATH, // MUST be the signed path, not the URL with /sync
    body,
    host: HOST,
  });

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
  if (!res.ok) throw new Error(`append failed: ${res.status} ${await res.text()}`);
}

// userId = first 32 hex chars of sha256(pubkey bytes) — mirrors the SDK derivation.
async function userIdFromPubHex(edPubHex: string): Promise<string> {
  const bytes = Uint8Array.from(edPubHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
```

> **Shortcut (recommended for TS bots):** instead of hand‑signing per request you can
> use the SDK client, which builds the same headers and prefixes paths for you:
>
> ```ts
> import { StarfishClient } from "@drakkar.software/starfish-client";
> const client = new StarfishClient({
>   baseUrl: "https://<host>/sync",
>   capProvider: { async getCap() { return { cap: parsed.cap, devEdPrivHex: bot.edPriv, pubHex: bot.edPub }; } },
> });
> await client.append("/v1/octochat/push/spaces/<spaceId>/streams/pub/<roomId>",
>                      { t: "msg", e: { id: crypto.randomUUID(), authorId: botUserId, ts: Date.now(), text } });
> ```

---

## Bots on a PRIVATE (E2EE) room

A public link grants **authority, not decryption** — it cannot point at a `delegated`
collection. So an E2EE‑room bot is enrolled as a **keyring member**, exactly like a
human member, and must **seal each element with the space keyring** before appending.
There is no "Connect a bot" panel for private rooms; use the member‑invite flow.

### 1. Enroll the bot (one‑time, owner side)

1. The bot generates a keypair and sends the owner a join request — its public
   identity only:

   ```ts
   import { generateDeviceKeys } from "@drakkar.software/starfish-identities";
   const bot = generateDeviceKeys();
   const botUserId = await userIdFromPubHex(bot.edPub);
   const joinRequest = JSON.stringify({ edPub: bot.edPub, kemPub: bot.kemPub, userId: botUserId });
   ```

2. The owner invites it from the space — `inviteToSpace(session, spaceId, joinRequest)`
   (`packages/sdk/src/starfish/members.ts`). That adds the bot's KEM key to the
   space keyring (`addCollectionRecipient`) and mints a space‑scoped **member cap**.
   The owner hands the bot the resulting cap (the `cap` field of the invite bundle).

### 2. Bot seals and appends

The bot holds its keypair + the member cap. It pulls the space keyring, builds an
encryptor, seals the envelope, and appends. Using the SDK client (it signs requests,
incl. `X-Starfish-Alg`, and applies the namespace prefix):

```ts
import { StarfishClient } from "@drakkar.software/starfish-client";
import { createKeyringEncryptor } from "@drakkar.software/starfish-keyring";

const cap = JSON.parse(INVITE_CAP_JSON);              // owner-issued member cap
const PREFIX = "/v1/octochat";                        // "" against a local dev server
const client = new StarfishClient({
  baseUrl: "https://<host>/sync",                     // "http://localhost:8787" locally
  capProvider: { async getCap() { return { cap, devEdPrivHex: bot.edPriv }; } },
});

// 1. Pull the space keyring and build the encryptor (the bot is a recipient of it).
//    `trustedAdders` pins who may have granted keyring access — the cap's issuer (owner).
const kr = await client.pull(`${PREFIX}/pull/spaces/${SPACE_ID}/_keyring`);
const enc = await createKeyringEncryptor(
  kr.data,
  { kemPubHex: bot.kemPub, kemPrivHex: bot.kemPriv },
  { trustedAdders: [cap.iss] },
);

// 2. Seal each element and append (no client-supplied ts → server assigns a monotonic one).
export async function postMessage(text: string): Promise<void> {
  const element = { t: "msg", e: { id: crypto.randomUUID(), authorId: botUserId, ts: Date.now(), text } };
  const sealed = await enc.encrypt(element);          // { _encrypted, _epoch } — opaque to the server
  await client.append(`${PREFIX}/push/spaces/${SPACE_ID}/streams/${ROOM_ID}`, sealed);
}
```

The app decrypts the bot's sealed appends with the same space keyring and renders them
inline. If the owner rotates the keyring (e.g. evicts a member), re‑pull the keyring
so the encryptor uses the current epoch.

---

## Security notes

- **Public‑link tokens carry no secret.** A leaked token is useless without the bot's
  private key (which never leaves the bot). Prefer `allowedIdentities` to pin the bot's
  pubkey, and a short `ttlSec`; re‑generate to rotate.
- **Least privilege.** A bot link is scoped to exactly one room's path, so it
  can only append there — not read other rooms, not touch `_keyring`/`_access`.
- **Attribution.** Every append is signed; the server attributes a public‑room write
  to the redeemer's own key (`X-Starfish-Pub`). Open links are only as trustworthy as a
  self‑asserted, possibly throwaway identity — pin `allowedIdentities` if that matters.
- **E2EE stays E2EE.** A private‑room bot is a keyring recipient; its posts are sealed
  client‑side and never readable by the server. Removing a bot = rotate the keyring.
- **Don't point a public link at an encrypted collection** — it grants write authority
  but cannot decrypt, so its posts would be unreadable garbage to the app.
