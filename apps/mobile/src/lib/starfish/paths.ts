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

import { SYNC_PREFIX } from './config';

/**
 * Request-path helpers. The action path is signed relative to SYNC_BASE; the
 * SYNC_PREFIX ('' locally, '/v1/octochat' deployed) is part of the SIGNED path so
 * it must live here, NOT in SYNC_BASE (the SDK signs the endpoint path, not the
 * baseUrl path). Storage-name helpers (keyringName/attachmentName/sharedFeedName)
 * stay UNPREFIXED — they're the object-storage keys / cap-scope paths the server
 * matches after stripping the action+namespace prefix.
 */
const pull = (rest: string) => `${SYNC_PREFIX}/pull/${rest}`;
const push = (rest: string) => `${SYNC_PREFIX}/push/${rest}`;

/** A room id is `sp-<rand>-<name>`; the space is its first two `-` segments. */
export const spaceIdFromRoomId = (roomId: string) => roomId.split('-').slice(0, 2).join('-');

// ── Channel messages (nested under their space) ───────────────────────────────
export const roomPull = (roomId: string) => pull(`spaces/${spaceIdFromRoomId(roomId)}/chat/rooms/${roomId}`);
export const roomPush = (roomId: string) => push(`spaces/${spaceIdFromRoomId(roomId)}/chat/rooms/${roomId}`);

// ── Space-wide keyring (one per space, shared by all its channels) ────────────
export const keyringName = (spaceId: string) => `spaces/${spaceId}`;
export const keyringPull = (spaceId: string) => pull(`${keyringName(spaceId)}/_keyring`);
export const keyringPush = (spaceId: string) => push(`${keyringName(spaceId)}/_keyring`);

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
export const attachmentPull = (roomId: string, blobId: string) => pull(attachmentName(roomId, blobId));
export const attachmentPush = (roomId: string, blobId: string) => push(attachmentName(roomId, blobId));

// ── Profile + registries ──────────────────────────────────────────────────────
export const profilePull = (userId: string) => pull(`user/${userId}/profile`);
export const profilePush = (userId: string) => push(`user/${userId}/profile`);

export const spacesPull = (userId: string) => pull(`user/${userId}/_spaces`);
export const spacesPush = (userId: string) => push(`user/${userId}/_spaces`);

export const roomsRegistryPull = (spaceId: string) => pull(`spaces/${spaceId}/_rooms`);
export const roomsRegistryPush = (spaceId: string) => push(`spaces/${spaceId}/_rooms`);

// ── Plaintext shares (broadcast / collaborative LINKS; NOT encrypted) ─────────
// A share is a single plaintext feed doc at `shared/{ownerId}/{shareId}/feed`. The
// owner publishes/manages it with their account cap (write gated `share:owner`); a
// link-bearer reads (and optionally writes) with a member cap the owner minted
// (gated `share:reader`/`share:writer`). See apps/server/src/share-role.ts.
export const sharedFeedName = (ownerId: string, shareId: string) => `shared/${ownerId}/${shareId}/feed`;
export const sharedFeedPull = (ownerId: string, shareId: string) => pull(sharedFeedName(ownerId, shareId));
export const sharedFeedPush = (ownerId: string, shareId: string) => push(sharedFeedName(ownerId, shareId));

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

/** Personal cap: profile + space registry + device directory + spaces + own shares. */
export function accountScope(userId: string): ScopePreset {
  return {
    ops: ['read', 'list', 'write'],
    collections: ['profile', 'devices', 'spaces', 'rooms', 'shared'],
    paths: [
      `user/${userId}/profile`,
      `users/${userId}/_devices`,
      `user/${userId}/_spaces`,
      'spaces/**',
      // The owner's own plaintext shares — server grants `share:owner` because this
      // is a device cap (auth.identity = issUserId = userId = the {ownerId} segment).
      `shared/${userId}/**`,
    ],
  };
}

/**
 * Link-bearer access to ONE plaintext share at `shared/{ownerId}/{shareId}`.
 * Read-only (broadcast link) or +write (collaborative link). The tight single-share
 * path is the per-cap isolation that complements the server's issuer-binding
 * enricher — a holder reaches only this one share. `collections:['shared']` is the
 * bare name the member-cap shape check keys off; the path never matches
 * `shared/_keyring`/`shared/_members`, so no deny rule is needed (cf.
 * `spaceMemberScope`). The subject is a throwaway ephemeral keypair, so this cap is
 * meaningless without the matching private key shipped alongside it in the link.
 */
export function broadcastReaderScope(ownerId: string, shareId: string, canWrite = false): ScopePreset {
  const ops: ('read' | 'write' | 'list')[] = canWrite ? ['read', 'list', 'write'] : ['read', 'list'];
  return {
    ops,
    collections: ['shared'],
    paths: [`shared/${ownerId}/${shareId}/**`],
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
