/**
 * Collection path + cap-scope helpers (ported from the satellite chat example).
 * Paths are signed relative to SYNC_BASE; the server mounts the sync router at
 * root, so they start with /pull or /push.
 *
 * Everything for a space is nested under `spaces/{spaceId}/…` so the `{spaceId}`
 * segment gates it all uniformly through the space:owner/space:member enricher,
 * and a single `spaces/{spaceId}/**` member cap covers a whole space. Keyrings
 * are SPACE-wide (one per space, shared by every channel). A room id is
 * `<spaceId>-<name…>`, so a room's space is derivable from its id.
 */
import type { ScopePreset } from '@drakkar.software/starfish-identities';

/** A room id is `sp-<rand>-<name>`; the space is its first two `-` segments. */
export const spaceIdFromRoomId = (roomId: string) => roomId.split('-').slice(0, 2).join('-');

// ── Channel messages (nested under their space) ───────────────────────────────
export const roomPull = (roomId: string) => `/pull/spaces/${spaceIdFromRoomId(roomId)}/chat/rooms/${roomId}`;
export const roomPush = (roomId: string) => `/push/spaces/${spaceIdFromRoomId(roomId)}/chat/rooms/${roomId}`;

// ── Space-wide keyring (one per space, shared by all its channels) ────────────
export const keyringName = (spaceId: string) => `spaces/${spaceId}`;
export const keyringPull = (spaceId: string) => `/pull/${keyringName(spaceId)}/_keyring`;
export const keyringPush = (spaceId: string) => `/push/${keyringName(spaceId)}/_keyring`;

// ── Attachments (sealed blobs, in a per-space subtree keyed by room) ──────────
// Deliberately NOT under `chat/rooms/{roomId}`: the server's FilesystemObjectStore
// maps a document key to a nested directory path, so a key can't be both a leaf
// file AND a directory prefix. The room's message doc is the leaf file
// `…/chat/rooms/{roomId}`, so nesting blobs beneath it made `mkdir` fail with
// ENOTDIR → an opaque server 500. A separate `attachments/{roomId}/…` subtree
// avoids the file/dir collision and is still covered by the `spaces/{spaceId}/**`
// member cap. Keep this in sync with the `attachments` storagePath in apps/server.
/** Storage path of one attachment blob — also the AAD bound into its seal. */
export const attachmentName = (roomId: string, blobId: string) =>
  `spaces/${spaceIdFromRoomId(roomId)}/attachments/${roomId}/${blobId}`;
export const attachmentPull = (roomId: string, blobId: string) => `/pull/${attachmentName(roomId, blobId)}`;
export const attachmentPush = (roomId: string, blobId: string) => `/push/${attachmentName(roomId, blobId)}`;

// ── Profile + registries ──────────────────────────────────────────────────────
export const profilePull = (userId: string) => `/pull/user/${userId}/profile`;
export const profilePush = (userId: string) => `/push/user/${userId}/profile`;

export const spacesPull = (userId: string) => `/pull/user/${userId}/_spaces`;
export const spacesPush = (userId: string) => `/push/user/${userId}/_spaces`;

export const roomsRegistryPull = (spaceId: string) => `/pull/spaces/${spaceId}/_rooms`;
export const roomsRegistryPush = (spaceId: string) => `/push/spaces/${spaceId}/_rooms`;

// ── Cap scopes ────────────────────────────────────────────────────────────────
/** Full owner/device access to every space the identity owns. */
export function ownerScope(): ScopePreset {
  return {
    ops: ['read', 'list', 'write'],
    collections: ['chat'],
    paths: ['spaces/**'],
  };
}

/**
 * Member access to one SPACE — its keyring + every channel's messages and
 * attachments + the room registry, all under `spaces/{spaceId}/**`. One cap
 * covers current AND future channels. The keyring/registry stay owner-only:
 * their WRITE is `space:owner`-gated server-side, so a member's path reach does
 * not grant write. (`collections:['chat']` keeps the member-cap shape check
 * happy — it keys off the collection name, never these paths.)
 */
export function spaceMemberScope(spaceId: string, canWrite: boolean): ScopePreset {
  const ops: ('read' | 'write' | 'list')[] = canWrite ? ['read', 'list', 'write'] : ['read', 'list'];
  return {
    ops,
    collections: ['chat'],
    paths: [`spaces/${spaceId}/**`],
  };
}

/** Personal cap: profile + space registry + device directory + spaces. */
export function accountScope(userId: string): ScopePreset {
  return {
    ops: ['read', 'list', 'write'],
    collections: ['profile', 'devices', 'spaces', 'rooms'],
    paths: [
      `user/${userId}/profile`,
      `users/${userId}/_devices`,
      `user/${userId}/_spaces`,
      'spaces/**',
    ],
  };
}

/** Extract the space id a member cap is scoped to (from its `spaces/<id>/**`). */
export function spaceIdFromCap(cap: { scope?: { paths?: string[] } }): string | null {
  for (const p of cap.scope?.paths ?? []) {
    const m = /^spaces\/([^/]+)\//.exec(p);
    if (m) return m[1]!;
  }
  return null;
}

export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}
