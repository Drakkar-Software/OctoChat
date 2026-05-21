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
      storagePath: "chat/rooms/{roomId}",
      readRoles: ["cap:read:chat"],
      writeRoles: ["cap:write:chat"],
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
      storagePath: "chatkeyring/spaces/{spaceId}/_keyring",
      readRoles: ["space:member"],
      writeRoles: ["space:owner"],
      encryption: "none",
      maxBodyBytes: 65_536,
      allowedMimeTypes: JSON_ONLY,
    },
    // Encrypted file attachments for a room. Bytes are sealed client-side with
    // the space keyring CEK (sealBytes), so the collection itself is "none" —
    // the server only ever holds opaque ciphertext (application/octet-stream).
    // Authorized by the same chat cap (gated by the attachments path scope).
    {
      name: "attachments",
      storagePath: "attachments/rooms/{roomId}/{blobId}",
      readRoles: ["cap:read:chat"],
      writeRoles: ["cap:write:chat"],
      encryption: "none",
      maxBodyBytes: 11_534_336, // ~11 MB: ~10 MB plaintext + IV/tag/epoch overhead.
      allowedMimeTypes: ["application/octet-stream"],
    },
    // Public-readable profile; only the self-signed root device may write.
    {
      name: "profile",
      storagePath: "user/{identity}/profile",
      readRoles: ["public"],
      writeRoles: ["device:root"],
      encryption: "none",
      maxBodyBytes: 8_192,
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
