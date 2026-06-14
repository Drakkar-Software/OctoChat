import type { SyncConfig } from "@drakkar.software/starfish-server";

/**
 * Starfish collection layout for OctoChat.
 *
 * Encryption is "delegated" (opaque ciphertext, multi-recipient keyring) only
 * for private/E2EE room message logs (`streamchat`). All other collections
 * are "none" — either plaintext metadata read-gated by caps and the space-role
 * enricher, or content whose access tier is enforced by the collection's roles.
 *
 * Per-node access model (octospaces-sdk@0.4.3):
 *   - `objindex` — always PLAINTEXT (none). Room/category/DM titles, automation
 *     metadata (providerId, params, botUserId, lastError, …) are stored in clear
 *     and visible to the server — accepted trade-off for the POC (the projection
 *     must read node `access` fields, which sealed content would hide). NOTE:
 *     invite-node title stripping ("stripped client-side before storage") is NOT
 *     yet implemented; titles land in the plaintext index — a gap to close before
 *     invite rooms ship. Bot `credential` blobs remain sealToSelf-sealed.
 *   - `objpub`   — PUBLIC node content (access:'public'); world-readable.
 *   - `objinv`   — INVITE-ONLY node content (access:'invite'+enc:false); gated
 *     entirely by per-node cap via the sharing-plugin path-match.
 *   - `streamchat`  — private/E2EE room logs; space:member only.
 *   - `streampub`   — public room logs (access:'public'); world-readable.
 *   - `streaminv`   — invite-only plaintext room logs (access:'invite'+enc:false);
 *     gated by per-node cap (read:[] write:[]).
 *
 * Files to keep in sync:
 *   Infra/sync/server/drakkar_sync/apps/octochat/collections.py  (byte-for-byte Python mirror)
 *   packages/sdk/src/starfish/paths.ts  (path helpers must match storagePaths)
 *
 *   {identity}   - resolver enforces it equals the cap-bound user id
 *   {roomId} / {spaceId} / {nodeId} / {rendezvousId} - free path params
 */
const JSON_ONLY = ["application/json"];

export const config: SyncConfig = {
  version: 1,
  collections: [
    // SPACE-wide multi-recipient keyring: one keyring (and CEK) per space, shared
    // by ALL enc rooms in the space. READ gated on `space:member` (any space member
    // can fetch it and decrypt), WRITE on `space:owner` (only the owner adds
    // recipients on invite or rotates on revoke) — both synthesized by
    // makeSpaceRoleEnricher from the space access record (spaces/{spaceId}/_access).
    // Renamed from `chatkeyring` (0.4.1): collection is `spacekeyring` everywhere.
    {
      name: "spacekeyring",
      storagePath: "spaces/{spaceId}/_keyring",
      readRoles: ["space:member"],
      writeRoles: ["space:owner"],
      encryption: "none",
      maxBodyBytes: 65_536,
      allowedMimeTypes: JSON_ONLY,
    },
    // SPACE access record `{ owner, members:[…], name, image }`. READ gated on
    // `space:member`, WRITE on `space:owner`. The space-role enricher reads THIS doc
    // to synthesize space:member / space:owner for every other collection.
    // Renamed from `rooms` (0.4.1): storage leaf `_rooms` → `_access`.
    {
      name: "spaceregistry",
      storagePath: "spaces/{spaceId}/_access",
      readRoles: ["space:member"],
      writeRoles: ["space:owner"],
      encryption: "none",
      maxBodyBytes: 131_072,
      allowedMimeTypes: JSON_ONLY,
    },
    // Encrypted file attachments, in a per-space subtree keyed by room. Bytes are
    // sealed client-side with the space keyring CEK (sealBytes), so the collection
    // itself is "none" — the server only ever holds opaque ciphertext. Covered by
    // the `spaces/{spaceId}/**` member cap; not split by room access tier (attach
    // button gated to non-public rooms in the UI; attpub/attinv to be added later).
    {
      name: "attachments",
      storagePath: "spaces/{spaceId}/attachments/{roomId}/{blobId}",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "none",
      maxBodyBytes: 11_534_336, // ~11 MB: ~10 MB plaintext + IV/tag/epoch overhead.
      allowedMimeTypes: ["application/octet-stream"],
    },
    // ROOM messages (private/E2EE, access:'space' or 'invite'+enc:true): append-only
    // message log, one doc per room. Encryption "delegated": each appended element is
    // sealed with the space keyring CEK, opaque to the server. Read/write gated on
    // `space:member` — invite+enc rooms grant the invitee space membership (so they
    // hold the keyring), reusing this same collection. Keep in sync with
    // streamRoomName in packages/sdk + Infra collections.py.
    {
      name: "streamchat",
      storagePath: "spaces/{spaceId}/streams/{roomId}",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "delegated",
      appendOnly: { type: "by_timestamp" },
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // PUBLIC ROOM messages (access:'public', enc:false only): world-readable append-only
    // plaintext log. Mirrors objpub — read 'public' (anonymous browse), write
    // 'space:member' (owner/members post; bots post via a member/audience cap minted by
    // the owner). 'none' encryption: public rooms are plaintext. Append-only by_timestamp
    // so a bot/integration posts with no keyring — just a signed append.
    // 'streams/pub/{roomId}' avoids file-vs-directory collision with the private
    // 'streams/{roomId}' leaf. Keep in sync with streamPubRoomName in packages/sdk +
    // Infra collections.py.
    {
      name: "streampub",
      storagePath: "spaces/{spaceId}/streams/pub/{roomId}",
      readRoles: ["public"],
      writeRoles: ["space:member"],
      encryption: "none",
      appendOnly: { type: "by_timestamp" },
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // INVITE ROOM messages (access:'invite', enc:false only): cap-gated append-only
    // plaintext log. Mirrors objinv — read/write '[]'; access is entirely by the
    // per-node cap via the sharing-plugin path-match (nodeRoomScope covers
    // spaces/{spaceId}/streams/n/{roomId}/**). '{roomId}' is a directory, 'log' the
    // leaf (file-vs-directory rule; mirrors objinv's objects/n/{nodeId}/content).
    // Invite+enc rooms do NOT use this collection — they are space members and use
    // streamchat. Keep in sync with streamInvRoomName in packages/sdk + Infra.
    {
      name: "streaminv",
      storagePath: "spaces/{spaceId}/streams/n/{roomId}/log",
      readRoles: [],
      writeRoles: [],
      encryption: "none",
      appendOnly: { type: "by_timestamp" },
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // Public-readable profile; only the self-signed root device may write.
    {
      name: "profile",
      storagePath: "user/{identity}/profile",
      readRoles: ["public"],
      writeRoles: ["device:root"],
      encryption: "none",
      maxBodyBytes: 65_536,
      allowedMimeTypes: JSON_ONLY,
    },
    // Per-identity device directory.
    {
      name: "devices",
      storagePath: "users/{identity}/_devices",
      readRoles: ["cap:read:devices"],
      writeRoles: ["cap:write:devices"],
      encryption: "none",
      maxBodyBytes: 131_072,
      allowedMimeTypes: JSON_ONLY,
    },
    // Per-identity space registry.
    {
      name: "spaces",
      storagePath: "user/{identity}/_spaces",
      readRoles: ["cap:read:spaces"],
      writeRoles: ["cap:write:spaces"],
      encryption: "none",
      maxBodyBytes: 131_072,
      allowedMimeTypes: JSON_ONLY,
    },
    // OBJECT TREE (plaintext, member-gated): union-merged list of every ObjectNode in
    // a space — rooms, categories, automations, DMs. Titles/emoji of `invite` nodes
    // are stripped client-side before storage. WRITE is space:member (any member
    // creates rooms/categories). `none` encryption (0.4.1 change from `delegated`):
    // the projection reads node `access` fields to build the public-space directory —
    // sealed content would be unreadable. Keep in sync with objIndexName in
    // packages/sdk + Infra collections.py.
    {
      name: "objindex",
      storagePath: "spaces/{spaceId}/objects/_index",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "none",
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // PUBLIC NODE CONTENT (access:'public'): world-readable plaintext merge-doc.
    // Any anonymous caller may GET it; WRITE is space:member. Mirrors OctoVault's
    // objpub — room-level public metadata (description, topic, pinned-message
    // metadata, etc.) for public rooms. Keep in sync with objPubName in packages/sdk.
    {
      name: "objpub",
      storagePath: "spaces/{spaceId}/objects/pub/{nodeId}",
      readRoles: ["public"],
      writeRoles: ["space:member"],
      encryption: "none",
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // INVITE-ONLY NODE CONTENT (access:'invite'+enc:false): cap-gated plaintext doc.
    // read/write '[]' — gated entirely by the per-node cap via the sharing plugin
    // path-match. Mirrors OctoVault's objinv. Keep in sync with objInvName + Infra.
    {
      name: "objinv",
      storagePath: "spaces/{spaceId}/objects/n/{nodeId}/content",
      readRoles: [],
      writeRoles: [],
      encryption: "none",
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // SELF-SERVICE WEBHOOK REGISTRY: one owner-written doc per space mapping a
    // webhookId → `{ tokenHash, roomId, label, … }`. Re-homed from the retired
    // pubspace namespace onto the space subtree (0.4.1). Lets a space OWNER mint
    // their own inbound webhooks: WRITE is gated on `space:owner` (only the owner
    // manages their webhooks), READ on `space:owner`. The inbound `/webhook` route
    // reads this doc IN-PROCESS to authenticate a caller by hashed token — only the
    // SHA-256 of each token is stored here, never the raw token.
    {
      name: "webhooks",
      storagePath: "spaces/{spaceId}/_webhooks",
      readRoles: ["space:owner"],
      writeRoles: ["space:owner"],
      encryption: "none",
      maxBodyBytes: 131_072,
      allowedMimeTypes: JSON_ONLY,
    },
    // PUBLIC-SPACE DIRECTORY: a server-maintained list document indexing every
    // discoverable space (i.e. spaces with at least one `access:'public'` ObjectNode),
    // written ONLY by the `starfish-projection` plugin (see projections.ts) — every
    // `objindex` write that contains a public node upserts into `_index/spaces/public`.
    // `pullOnly` rejects all client writes; `readRoles: ["public"]` lets the Explore
    // screen browse it anonymously. `{shard}` is the access tier — only `public` is
    // materialized. Keep in sync with spaceIndexName in packages/sdk.
    {
      name: "spaceindex",
      storagePath: "_index/spaces/{shard}",
      readRoles: ["public"],
      writeRoles: [],
      pullOnly: true,
      encryption: "none",
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // Anonymous rendezvous slot for QR device pairing.
    {
      name: "pairing",
      storagePath: "_pairing/{rendezvousId}",
      readRoles: ["public"],
      writeRoles: ["public"],
      encryption: "none",
      maxBodyBytes: 16_384,
      allowedMimeTypes: JSON_ONLY,
    },
    // DM INBOX: the per-recipient delivery channel behind the shareable "DM me"
    // link — the cross-space alternative to the shared-space carrier.
    // ANYONE may anonymously APPEND a DM invite sealed to the owner's published KEM
    // key (an opaque SealedBlob — the server never reads invite contents). READ is
    // owner-only: `{identity}` is resolver-enforced to equal the cap-bound user id.
    // TIME-SHARDED by UTC month (`{shard}` = `YYYY-MM`): maxItems bounds a single
    // shard, so a flood self-heals at the next boundary. Per-IP rate limit + small
    // body cap throttle the fill rate. Keep in sync with dminboxName in packages/sdk.
    {
      name: "dminbox",
      storagePath: "dminbox/{identity}/{shard}",
      readRoles: ["cap:read:dminbox"],
      writeRoles: ["public"],
      encryption: "none",
      appendOnly: { type: "by_timestamp", maxItems: 500 },
      maxBodyBytes: 16_384,
      allowedMimeTypes: JSON_ONLY,
      rateLimit: {
        push: { windowMs: 60_000, maxRequests: 30, bucket: "ip" },
      },
    },
  ],
};
