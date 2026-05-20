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
    // Plaintext multi-recipient keyring for a room (kept on its own top-level
    // path so a member cap can read it without tripping the _keyring deny).
    {
      name: "chatkeyring",
      storagePath: "chatkeyring/rooms/{roomId}/_keyring",
      readRoles: ["cap:read:chat"],
      writeRoles: ["cap:write:chat"],
      encryption: "none",
      maxBodyBytes: 65_536,
      allowedMimeTypes: JSON_ONLY,
    },
    // Signed member-cap directory for a room.
    {
      name: "chatmembers",
      storagePath: "chatmembers/rooms/{roomId}/_members",
      readRoles: ["cap:read:chat"],
      writeRoles: ["cap:write:chat"],
      encryption: "none",
      maxBodyBytes: 131_072,
      allowedMimeTypes: JSON_ONLY,
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
    // Per-space room registry.
    {
      name: "rooms",
      storagePath: "spaces/{spaceId}/_rooms",
      readRoles: ["cap:read:rooms"],
      writeRoles: ["cap:write:rooms"],
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
