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

/**
 * Request-path helpers. These emit the bare action path (`/pull/…`, `/push/…`);
 * the StarfishClient's `namespace` option prepends `/v1/<namespace>` (deployed) for
 * BOTH the URL and the signed canonical path, so the namespace must NOT be baked in
 * here. Storage-name helpers (keyringName/attachmentName/pubspaceRoomName) stay bare
 * too — they're the object-storage keys / cap-scope paths the server matches after
 * stripping the action+namespace prefix.
 */
const pull = (rest: string) => `/pull/${rest}`;
const push = (rest: string) => `/push/${rest}`;

/** A room id is `sp-<rand>-<name>`; the space is its first two `-` segments. */
export const spaceIdFromRoomId = (roomId: string) => roomId.split('-').slice(0, 2).join('-');

// ── Channel messages (nested under their space) ───────────────────────────────
export const roomPull = (roomId: string) => pull(`spaces/${spaceIdFromRoomId(roomId)}/chat/rooms/${roomId}`);
export const roomPush = (roomId: string) => push(`spaces/${spaceIdFromRoomId(roomId)}/chat/rooms/${roomId}`);

// ── Stream rooms (private/E2EE): append-only log, one doc per stream room ─────
// Distinct `streams/` subtree (not under chat/rooms) so a stream-room id can be a
// leaf document without colliding with the chat/rooms or attachments subtrees.
// Covered by the same `spaces/{spaceId}/**` member cap as the chat collection;
// gated `space:member` server-side. Writers APPEND (no pull/merge). Keep the path
// in sync with the `streamchat` collection in apps/server (+ Infra collections.py).
export const streamRoomName = (roomId: string) =>
  `spaces/${spaceIdFromRoomId(roomId)}/streams/${roomId}`;
export const streamRoomPull = (roomId: string) => pull(streamRoomName(roomId));
export const streamRoomPush = (roomId: string) => push(streamRoomName(roomId));

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

// ── Public spaces (plaintext; NOT encrypted) ──────────────────────────────────
// A public space lives under the owner's `pubspaces/{ownerId}/{spaceId}/` subtree:
// a `_rooms` registry doc + one plaintext message doc per room. The owner manages
// it with their account cap (gated `pubspace:owner`); a link-bearer reads (and,
// with a read/write link, writes room docs) via a member cap the owner minted
// (gated `pubspace:reader`/`pubspace:writer`). See apps/server/src/pubspace-role.ts.
const pubspaceBase = (ownerId: string, spaceId: string) => `pubspaces/${ownerId}/${spaceId}`;
export const pubspaceRoomsName = (ownerId: string, spaceId: string) => `${pubspaceBase(ownerId, spaceId)}/_rooms`;
export const pubspaceRoomsPull = (ownerId: string, spaceId: string) => pull(pubspaceRoomsName(ownerId, spaceId));
export const pubspaceRoomsPush = (ownerId: string, spaceId: string) => push(pubspaceRoomsName(ownerId, spaceId));
export const pubspaceRoomName = (ownerId: string, spaceId: string, roomId: string) =>
  `${pubspaceBase(ownerId, spaceId)}/${roomId}`;
export const pubspaceRoomPull = (ownerId: string, spaceId: string, roomId: string) =>
  pull(pubspaceRoomName(ownerId, spaceId, roomId));
export const pubspaceRoomPush = (ownerId: string, spaceId: string, roomId: string) =>
  push(pubspaceRoomName(ownerId, spaceId, roomId));

// ── Public stream rooms (plaintext, append-only) ──────────────────────────────
// A public space's stream rooms live in a `streams/` subtree under the owner's
// space, in the append-only `pubstream` collection. A bot posts by APPENDING here
// (POST /push, no pull/merge), authorized by a `createPublicLink` audience cap (see
// stream-bots.ts). Keep in sync with the `pubstream` collection in apps/server.
export const pubstreamRoomName = (ownerId: string, spaceId: string, roomId: string) =>
  `pubspaces/${ownerId}/${spaceId}/streams/${roomId}`;
export const pubstreamRoomPull = (ownerId: string, spaceId: string, roomId: string) =>
  pull(pubstreamRoomName(ownerId, spaceId, roomId));
export const pubstreamRoomPush = (ownerId: string, spaceId: string, roomId: string) =>
  push(pubstreamRoomName(ownerId, spaceId, roomId));

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

/** Personal cap: profile + space registry + device directory + spaces + own public spaces. */
export function accountScope(userId: string): ScopePreset {
  return {
    ops: ['read', 'list', 'write'],
    collections: ['profile', 'devices', 'spaces', 'rooms', 'pubspace'],
    paths: [
      `user/${userId}/profile`,
      `users/${userId}/_devices`,
      `user/${userId}/_spaces`,
      'spaces/**',
      // The owner's own public spaces — server grants `pubspace:owner` because this is
      // a device cap (auth.identity = issUserId = userId = the {ownerId} segment).
      `pubspaces/${userId}/**`,
    ],
  };
}

/**
 * The single cap-cert scope granted to a PAIRED (linked) device. It must serve
 * BOTH clients a normal session splits across two self-minted caps — the chat
 * client ({@link ownerScope}: `chat`/`spaces/**`) AND the account client
 * ({@link accountScope}: profile + `_spaces` registry + devices + own public
 * spaces) — because a paired device cannot self-mint (its fresh keypair ≠ root),
 * so the root device delegates ONE `capCert` here that has to cover everything
 * startup reads. The union of the two presets, deduped.
 */
export function linkedDeviceScope(userId: string): ScopePreset {
  return {
    ops: ['read', 'list', 'write'],
    collections: ['chat', 'profile', 'devices', 'spaces', 'rooms', 'pubspace'],
    paths: [
      'spaces/**',
      `user/${userId}/profile`,
      `users/${userId}/_devices`,
      `user/${userId}/_spaces`,
      `pubspaces/${userId}/**`,
    ],
  };
}

/**
 * Link-bearer access to ONE public space at `pubspaces/{ownerId}/{spaceId}` —
 * space-wide (every room + the room registry), read-only or read/write. The tight
 * single-space path is the per-space isolation that complements the server's
 * issuer-binding enricher (a holder reaches only this one space); `pubspace:writer`
 * is further withheld on the `_rooms` doc server-side. `collections:['pubspace']` is
 * the bare name the member-cap shape check keys off; the path never matches
 * `pubspace/_keyring`/`pubspace/_members`, so no deny rule is needed (cf.
 * `spaceMemberScope`). The subject is a throwaway ephemeral keypair, so this cap is
 * meaningless without the matching private key shipped alongside it in the link.
 */
export function pubspaceScope(ownerId: string, spaceId: string, canWrite = false): ScopePreset {
  const ops: ('read' | 'write' | 'list')[] = canWrite ? ['read', 'list', 'write'] : ['read', 'list'];
  return {
    ops,
    collections: ['pubspace'],
    paths: [`pubspaces/${ownerId}/${spaceId}/**`],
  };
}

/**
 * Bot scope for ONE public stream room — the scope of the `createPublicLink`
 * audience cap an owner mints so a bot/integration can APPEND to that room's log.
 * Pinned to the single room's storage path (least privilege: a leaked link can
 * only append to this one stream, nothing else in the space). `collections` is the
 * bare `pubstream` name the audience-cap shape check keys off; the path is the real
 * `pubspaces/{ownerId}/{spaceId}/streams/{roomId}` storage key (NOT `pubstream/…`),
 * so — like `pubspaceScope` — it never matches `pubstream/_keyring`/`_members` and
 * needs no deny rule. Read+list are kept so the bot can read back its own appends.
 */
export function pubstreamBotScope(ownerId: string, spaceId: string, roomId: string): ScopePreset {
  return {
    ops: ['read', 'list', 'write'],
    collections: ['pubstream'],
    paths: [`pubspaces/${ownerId}/${spaceId}/streams/${roomId}`],
  };
}

/** Extract the single space id a member cap is scoped to (from its `spaces/<id>/**`).
 *  Returns null if the cap names no space path OR more than one distinct space — a
 *  member cap is expected to be scoped to exactly one space, so an ambiguous
 *  multi-space cap is rejected rather than silently read as just its first match. */
export function spaceIdFromCap(cap: { scope?: { paths?: string[] } }): string | null {
  let found: string | null = null;
  for (const p of cap.scope?.paths ?? []) {
    const m = /^spaces\/([^/]+)\//.exec(p);
    if (!m) continue;
    if (found !== null && found !== m[1]) return null; // ambiguous multi-space cap
    found = m[1]!;
  }
  return found;
}

export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}
