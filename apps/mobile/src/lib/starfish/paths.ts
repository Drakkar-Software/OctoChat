/**
 * Collection path + cap-scope helpers (ported from the satellite chat example).
 * Paths are signed relative to SYNC_BASE; the server mounts the sync router at
 * root, so they start with /pull or /push.
 *
 * Keyrings are SPACE-wide: every channel in a space shares one keyring (and CEK),
 * so a single space invite grants all of its channels. A room id is `<spaceId>-…`,
 * so the space a room belongs to is derivable from the id (see spaceIdFromRoomId).
 */
import type { ScopePreset } from '@drakkar.software/starfish-identities';

// ── Rooms / messages ────────────────────────────────────────────────────────
export const roomPull = (id: string) => `/pull/chat/rooms/${id}`;
export const roomPush = (id: string) => `/push/chat/rooms/${id}`;

/** A room id is `sp-<rand>-<name…>`; the space is its first two `-` segments. */
export const spaceIdFromRoomId = (roomId: string) => roomId.split('-').slice(0, 2).join('-');

// ── Space-wide keyring (one per space, shared by all its channels) ────────────
export const keyringName = (spaceId: string) => `chatkeyring/spaces/${spaceId}`;
export const keyringPull = (spaceId: string) => `/pull/${keyringName(spaceId)}/_keyring`;
export const keyringPush = (spaceId: string) => `/push/${keyringName(spaceId)}/_keyring`;

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
/** Full owner/device access: every room message + every space keyring + attachments. */
export function ownerScope(): ScopePreset {
  return {
    ops: ['read', 'list', 'write'],
    collections: ['chat'],
    paths: ['chat/rooms/**', 'chatkeyring/spaces/**', 'attachments/rooms/**'],
  };
}

/**
 * Member access to one SPACE: every channel's messages + attachments + the
 * space keyring. `chat/rooms/${spaceId}-*` covers all current AND future
 * channels of the space (a room id is a single segment `${spaceId}-…`, and the
 * cap `*` glob matches a run of non-slash chars), so one cap never goes stale.
 */
export function spaceMemberScope(spaceId: string, canWrite: boolean): ScopePreset {
  const ops: ('read' | 'write' | 'list')[] = canWrite ? ['read', 'list', 'write'] : ['read', 'list'];
  return {
    ops,
    collections: ['chat'],
    paths: [`chat/rooms/${spaceId}-*`, `${keyringName(spaceId)}/_keyring`, `attachments/rooms/${spaceId}-*/**`],
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

/** Extract the space id a member cap is scoped to (from its keyring path). */
export function spaceIdFromCap(cap: { scope?: { paths?: string[] } }): string | null {
  for (const p of cap.scope?.paths ?? []) {
    const m = /^chatkeyring\/spaces\/([^/]+)\/_keyring$/.exec(p);
    if (m) return m[1]!;
  }
  return null;
}

export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}
