/**
 * Collection path + cap-scope helpers (ported from the satellite chat example).
 * Paths are signed relative to SYNC_BASE; the server mounts the sync router at
 * root, so they start with /pull or /push.
 */
import type { ScopePreset } from '@drakkar.software/starfish-identities';

// ── Rooms / messages ────────────────────────────────────────────────────────
export const roomPull = (id: string) => `/pull/chat/rooms/${id}`;
export const roomPush = (id: string) => `/push/chat/rooms/${id}`;

export const keyringName = (id: string) => `chatkeyring/rooms/${id}`;
export const keyringPull = (id: string) => `/pull/${keyringName(id)}/_keyring`;
export const keyringPush = (id: string) => `/push/${keyringName(id)}/_keyring`;

export const membersName = (id: string) => `chatmembers/rooms/${id}`;
export const membersPull = (id: string) => `/pull/${membersName(id)}/_members`;
export const membersPush = (id: string) => `/push/${membersName(id)}/_members`;

// ── Attachments (sealed binary blobs) ─────────────────────────────────────────
/** Storage path of one attachment blob — also the AAD bound into its seal. */
export const attachmentName = (roomId: string, blobId: string) => `attachments/rooms/${roomId}/${blobId}`;
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
/** Full owner/device access: every room + keyring + member directory. */
export function ownerScope(): ScopePreset {
  return {
    ops: ['read', 'list', 'write'],
    collections: ['chat'],
    paths: ['chat/rooms/**', 'chatkeyring/rooms/**', 'chatmembers/rooms/**', 'attachments/rooms/**'],
  };
}

/** Member access to ONE room (read + optional write). */
export function memberScope(roomId: string, canWrite: boolean): ScopePreset {
  const ops: ('read' | 'write' | 'list')[] = canWrite ? ['read', 'list', 'write'] : ['read', 'list'];
  return {
    ops,
    collections: ['chat'],
    paths: [`chat/rooms/${roomId}`, `${keyringName(roomId)}/_keyring`, `attachments/rooms/${roomId}/**`],
  };
}

/** Personal cap: profile + space/room registries + device directory. */
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

/** Extract the room id a member cap is scoped to. */
export function roomIdFromCap(cap: { scope?: { paths?: string[] } }): string | null {
  for (const p of cap.scope?.paths ?? []) {
    const m = /^chat\/rooms\/([^/]+)$/.exec(p);
    if (m) return m[1]!;
  }
  return null;
}

export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}
