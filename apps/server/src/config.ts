import type { SyncConfig } from "@drakkar.software/starfish-server";

/**
 * Starfish collection layout for OctoChat.
 *
 * Encryption is "delegated" (opaque ciphertext, multi-recipient keyring) only
 * for room message documents. Keyrings, member directories, profiles and the
 * space/room registries are plaintext ("none") metadata, read-gated by caps.
 *
 *   {identity}  - resolver enforces it equals the cap-bound user id
 *   {roomId} / {spaceId} / {rendezvousId} - free path params
 */
const JSON_ONLY = ["application/json"];

export const config: SyncConfig = {
  version: 1,
  collections: [
    // Encrypted room messages.
    {
      name: "chat",
      storagePath: "spaces/{spaceId}/chat/rooms/{roomId}",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "delegated",
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // SPACE-wide multi-recipient keyring: one keyring (and CEK) per space, shared
    // by all its channels. READ is gated on `space:member` (so any space member
    // can fetch it and decrypt), WRITE on `space:owner` (only the owner may add
    // recipients on invite or rotate on revoke) — both synthesized by
    // makeSpaceRoleEnricher from the space registry's owner/members record.
    {
      name: "chatkeyring",
      storagePath: "spaces/{spaceId}/_keyring",
      readRoles: ["space:member"],
      writeRoles: ["space:owner"],
      encryption: "none",
      maxBodyBytes: 65_536,
      allowedMimeTypes: JSON_ONLY,
    },
    // Encrypted file attachments, in a per-space subtree keyed by room. Bytes are
    // sealed client-side with the space keyring CEK (sealBytes), so the collection
    // itself is "none" — the server only ever holds opaque ciphertext
    // (application/octet-stream). Covered by the same `spaces/{spaceId}/**` member
    // cap as the room messages. NOT nested under `chat/rooms/{roomId}`: the
    // FilesystemObjectStore maps a key to a nested directory, so a key can't be
    // both the room's message-doc leaf file AND a directory prefix (mkdir →
    // ENOTDIR → an opaque 500). Keep in sync with attachmentName in apps/mobile.
    {
      name: "attachments",
      storagePath: "spaces/{spaceId}/attachments/{roomId}/{blobId}",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "none",
      maxBodyBytes: 11_534_336, // ~11 MB: ~10 MB plaintext + IV/tag/epoch overhead.
      allowedMimeTypes: ["application/octet-stream"],
    },
    // STREAM rooms (private/E2EE): append-only message log, one document per stream
    // room. Backed by an append-only `by_timestamp` collection so a writer just
    // appends (POST /push with `{data}`) — no pull/merge/hash/conflict — which is
    // what lets bots/integrations post without implementing the read-modify-write
    // sync protocol. Encryption is "delegated" (same as `chat`): each appended
    // element is sealed with the space keyring CEK, opaque to the server. Read/write
    // gated on `space:member` via makeSpaceRoleEnricher (collection-agnostic, keyed
    // on {spaceId}), so the same `spaces/{spaceId}/**` member cap already covers it.
    // Distinct `streams/` subtree (not under chat/rooms) avoids the file-vs-directory
    // collision noted on `attachments`. Keep in sync with streamRoom* in apps/mobile.
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
    // Public-readable profile; only the self-signed root device may write.
    // 64 KB holds the pseudo plus a downscaled avatar inlined as a JPEG data URI
    // (~160-192 px square); see uploadAvatar/avatar-image in apps/mobile.
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
    // Per-space room registry — also the space's access record
    // `{ owner, members:[…], rooms:[…] }`. READ gated on `space:member` (any
    // member sees the channel list), WRITE on `space:owner` (only the owner adds
    // channels / edits the roster), both via makeSpaceRoleEnricher. Gating on a
    // synthesized role (not a plain cap role) is what stops any authenticated cap
    // reading or overwriting ANY space by its free, guessable {spaceId}.
    {
      name: "rooms",
      storagePath: "spaces/{spaceId}/_rooms",
      readRoles: ["space:member"],
      writeRoles: ["space:owner"],
      encryption: "none",
      maxBodyBytes: 131_072,
      allowedMimeTypes: JSON_ONLY,
    },
    // UNIFIED OBJECT INDEX (private/E2EE): the union-merged list of every Object in
    // a space — rooms, categories, automations, docs, projects. Replaces the old
    // `rooms[]`/`categories[]` half of `_rooms` (which stays the owner-only ACCESS
    // record). Encryption "delegated" so object titles/emoji are sealed (a privacy
    // upgrade over `_rooms`, whose names were plaintext). WRITE is `space:member`
    // (not owner) — any member creates docs/projects/channels. The access record in
    // `_rooms` remains owner-only, so this can't be used to escalate membership.
    {
      name: "objindex",
      storagePath: "spaces/{spaceId}/objects/_index",
      readRoles: ["space:member"],
      writeRoles: ["space:member"],
      encryption: "delegated",
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // NOTE: doc/project CONTENT collections (objdoc/objlog + their public mirrors)
    // moved to the standalone OctoVault app, where they were rebuilt on WAL/CRDT
    // (pagelog/boardlog). The object INDEX (objindex/pubobjindex above) stays — it
    // backs OctoChat's room/category sidebar tree.
    // PUBLIC spaces: plaintext, cap-only spaces joined via a space-wide invitation
    // link. NOT end-to-end encrypted — the owner stores plaintext JSON here so a
    // link-bearer can read (or, with a read/write link, write) WITHOUT a keyring, a
    // seed, or an encrypted join. `{docId}` is the room registry (`_rooms`) or a room
    // id (one plaintext message doc per room); both sit under the owner's space
    // subtree. Keyed by a free `{ownerId}`, so access is gated on the synthesized
    // pubspace:owner/reader/writer roles from makePubspaceRoleEnricher (issuer-bound),
    // NOT a plain cap role — see pubspace-role.ts.
    {
      name: "pubspace",
      storagePath: "pubspaces/{ownerId}/{spaceId}/{docId}",
      readRoles: ["pubspace:reader"],
      writeRoles: ["pubspace:owner", "pubspace:writer"],
      encryption: "none",
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // STREAM rooms (public/plaintext): append-only message log in a public space's
    // subtree. Same append-only model as `streamchat` but plaintext (`none`), so an
    // external bot/integration can post with NO keyring and NO encryption — just a
    // signed append. Read gated on `pubspace:reader`, write on `pubspace:owner`/
    // `pubspace:writer` (issuer-bound) via makePubspaceRoleEnricher, which now covers
    // this collection too. The bot credential is a `createPublicLink` audience cap
    // scoped here (no embedded secret; the bot signs with its own key). Keep in sync
    // with pubstreamRoom* in apps/mobile.
    {
      name: "pubstream",
      storagePath: "pubspaces/{ownerId}/{spaceId}/streams/{roomId}",
      readRoles: ["pubspace:reader"],
      writeRoles: ["pubspace:owner", "pubspace:writer"],
      encryption: "none",
      appendOnly: { type: "by_timestamp" },
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // UNIFIED OBJECT INDEX (public/plaintext): mirror of `objindex` for public
    // spaces. Keyed by `{ownerId}`, gated on pubspace:owner/reader/writer (issuer-
    // bound). `none` encryption — public spaces are plaintext by definition.
    {
      name: "pubobjindex",
      storagePath: "pubspaces/{ownerId}/{spaceId}/objects/_index",
      readRoles: ["pubspace:reader"],
      writeRoles: ["pubspace:owner", "pubspace:writer"],
      encryption: "none",
      maxBodyBytes: 262_144,
      allowedMimeTypes: JSON_ONLY,
    },
    // (pubobjdoc/pubobjlog moved to OctoVault — see the note above.)
    // PUBLIC-SPACE DIRECTORY: a server-maintained list document indexing every
    // public space, written ONLY by the `starfish-projection` plugin (see
    // projections.ts) — every `pubspace` `_rooms` write folds the space's
    // `{ name, ownerId, image, rooms }` into the `_index/spaces/public` list.
    // `pullOnly` rejects all client writes (the projection writes in-process via
    // the store, bypassing HTTP role checks); `readRoles: ["public"]` lets the
    // Explore screen browse it anonymously, like `profile`. `{shard}` is the space
    // type — only `public` is materialized (private spaces are never indexed; an
    // aggregate index has one read-role and would leak invite-only spaces).
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
  ],
};
