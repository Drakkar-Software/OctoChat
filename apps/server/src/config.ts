import type { SyncConfig } from "@drakkar.software/starfish-server";

/**
 * Starfish collection layout for OctoChat — migrated to the octospaces generic
 * backend (octospaces-sdk@0.8.0 / Infra server v0.3.0).
 *
 * Collection name mapping from the old octochat namespace:
 *   streamchat  → objlog      (spaces/{spaceId}/objects/logs/{roomId})
 *   streampub   → objpublog   (spaces/{spaceId}/objects/pub/{roomId}/log)
 *   streaminv   → objinvlog   (spaces/{spaceId}/objects/n/{roomId}/log)
 *   webhooks    → objowner    (spaces/{spaceId}/objects/owner/{nodeId})
 *   dminbox     → inbox       (inbox/{identity}/{shard})
 *
 * Encryption is "delegated" (opaque ciphertext, multi-recipient keyring) only
 * for private/E2EE room message logs (`objlog`). All other collections are
 * "none" — either plaintext metadata read-gated by caps and the space-role
 * enricher, or content whose access tier is enforced by the collection's roles.
 *
 * Per-node access model (octospaces-sdk@0.8.0):
 *   - `objindex`  — always PLAINTEXT (none).
 *   - `objpub`    — PUBLIC node content (access:'public'); world-readable.
 *   - `objinv`    — INVITE-ONLY node content (access:'invite'+enc:false); gated
 *     entirely by per-node cap via the sharing-plugin path-match.
 *   - `objlog`    — private/E2EE room logs; space:member only.
 *   - `objpublog` — public room logs (access:'public'); world-readable.
 *   - `objinvlog` — invite-only plaintext room logs (access:'invite'+enc:false);
 *     gated by per-node cap (read:[] write:[]).
 *   - `objowner`  — owner-only content (space:owner only).
 *
 * Files to keep in sync:
 *   Infra/sync/server/drakkar_sync/apps/octospaces/collections.py  (byte-for-byte Python mirror)
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
    {
      name: "spaceregistry",
      storagePath: "spaces/{spaceId}/_access",
      readRoles: ["space:member"],
      writeRoles: ["space:owner"],
      encryption: "none",
      maxBodyBytes: 131_072,
      allowedMimeTypes: JSON_ONLY,
    },
    // Encrypted file/image blobs (sealed client-side with the space keyring CEK).
    // Keyed by space + blobId — mirrors octospaces `objblob`. Server stores opaque
    // ciphertext ("none" encryption). Covered by the `spaces/{spaceId}/**` member cap.
    {
      name: "objblob",
      storagePath: "spaces/{spaceId}/objects/blobs/{blobId}",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "none",
      maxBodyBytes: 11_534_336, // ~11 MB: ~10 MB plaintext + IV/tag/epoch overhead.
      allowedMimeTypes: ["application/octet-stream"],
    },
    // ROOM messages (private/E2EE, access:'space' or 'invite'+enc:true): append-only
    // message log, one doc per room. Encryption "delegated": each appended element is
    // sealed with the space keyring CEK, opaque to the server. Read/write gated on
    // `space:member`. Keep in sync with streamRoomName in packages/sdk + Infra.
    {
      name: "objlog",
      storagePath: "spaces/{spaceId}/objects/logs/{roomId}",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "delegated",
      appendOnly: { type: "by_timestamp" },
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // PUBLIC ROOM messages (access:'public', enc:false only): world-readable append-only
    // plaintext log. Read 'public' (anonymous browse), write 'space:member'.
    // Append-only by_timestamp so a bot/integration posts with no keyring.
    // Keep in sync with streamPubRoomName in packages/sdk + Infra.
    {
      name: "objpublog",
      storagePath: "spaces/{spaceId}/objects/pub/{roomId}/log",
      readRoles: ["public"],
      writeRoles: ["space:member"],
      encryption: "none",
      appendOnly: { type: "by_timestamp" },
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // INVITE ROOM messages (access:'invite', enc:false only): cap-gated append-only
    // plaintext log. read/write '[]'; access is entirely by the per-node cap via the
    // sharing-plugin path-match (nodeRoomScope covers spaces/{spaceId}/objects/n/{roomId}/**).
    // Keep in sync with streamInvRoomName in packages/sdk + Infra.
    {
      name: "objinvlog",
      storagePath: "spaces/{spaceId}/objects/n/{roomId}/log",
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
    // a space — rooms, categories, automations, DMs. Keep in sync with objIndexName in
    // packages/sdk + Infra.
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
    // Keep in sync with objPubName in packages/sdk.
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
    // path-match. Keep in sync with objInvName + Infra.
    {
      name: "objinv",
      storagePath: "spaces/{spaceId}/objects/n/{nodeId}/content",
      readRoles: [],
      writeRoles: [],
      encryption: "none",
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // OWNER-ONLY NODE CONTENT (access:'owner'): owner-written doc per node.
    // Used for webhook registry at the reserved `_webhooks` node id.
    // WRITE gated on `space:owner`, READ on `space:owner`.
    // Keep in sync with spaceWebhooksName / objOwnerName in packages/sdk + Infra.
    {
      name: "objowner",
      storagePath: "spaces/{spaceId}/objects/owner/{nodeId}",
      readRoles: ["space:owner"],
      writeRoles: ["space:owner"],
      encryption: "none",
      maxBodyBytes: 131_072,
      allowedMimeTypes: JSON_ONLY,
    },
    // PUBLIC-SPACE DIRECTORY: a server-maintained list document indexing every
    // discoverable space. `pullOnly` rejects all client writes; `readRoles: ["public"]`
    // lets the Explore screen browse it anonymously. Keep in sync with spaceIndexName in
    // packages/sdk.
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
    // TIME-SHARDED by UTC month (`{shard}` = `YYYY-MM`). Keep in sync with
    // inboxName / dminboxName in packages/sdk + Infra.
    {
      name: "inbox",
      storagePath: "inbox/{identity}/{shard}",
      readRoles: ["cap:read:inbox"],
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
