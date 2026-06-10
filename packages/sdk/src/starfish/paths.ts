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
 * here. Storage-name helpers (keyringName/attachmentName/pubstreamRoomName) stay bare
 * too — they're the object-storage keys / cap-scope paths the server matches after
 * stripping the action+namespace prefix.
 */
const pull = (rest: string) => `/pull/${rest}`;
const push = (rest: string) => `/push/${rest}`;

/** A room id is `sp-<rand>-<name>`; the space is its first two `-` segments. */
export const spaceIdFromRoomId = (roomId: string) => roomId.split('-').slice(0, 2).join('-');

// ── Room messages (private/E2EE): append-only log, one log per room ───────────
// Since `stream` and `channel` merged, EVERY room is an append-only `streamchat` log
// in a `streams/` subtree (no merge-doc `chat` collection anymore). The `streams/`
// subtree (not under chat/rooms) keeps a room id a leaf document without colliding
// with the attachments subtree, and is covered by the same `spaces/{spaceId}/**`
// member cap; gated `space:member` server-side. Writers APPEND (no pull/merge). Keep
// the path in sync with the `streamchat` collection in apps/server (+ Infra collections.py).
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

// ── Unified Object index + content (private/E2EE) ─────────────────────────────
// `_index` (the union-merged ObjectNode list) is a leaf under `objects/`; doc
// content lives in the `objects/docs/` subtree and project logs in `objects/logs/`
// — distinct dir prefixes so a content id is a leaf without colliding with the
// `_index` leaf or each other (the file-vs-directory rule, see `attachmentName`).
// Room CONTENT stays in `chat`/`streams`; only docs/projects add content here.
// Keep in sync with the objindex/objdoc/objlog collections in apps/server.
export const objIndexName = (spaceId: string) => `spaces/${spaceId}/objects/_index`;
export const objIndexPull = (spaceId: string) => pull(objIndexName(spaceId));
export const objIndexPush = (spaceId: string) => push(objIndexName(spaceId));
// (Doc/project CONTENT paths — objDoc*/objLog* — moved to the OctoVault app along
// with the Work features; the object INDEX below stays, backing the room tree.)

// ── Unified Object index + content (public/plaintext) ─────────────────────────
export const pubObjIndexName = (ownerId: string, spaceId: string) => `${pubspaceBase(ownerId, spaceId)}/objects/_index`;
export const pubObjIndexPull = (ownerId: string, spaceId: string) => pull(pubObjIndexName(ownerId, spaceId));
export const pubObjIndexPush = (ownerId: string, spaceId: string) => push(pubObjIndexName(ownerId, spaceId));
// (Public doc/project content paths moved to the OctoVault app; pubObjIndex stays.)

// ── Public spaces (plaintext; NOT encrypted) ──────────────────────────────────
// A public space lives under the owner's `pubspaces/{ownerId}/{spaceId}/` subtree:
// a `_rooms` registry doc (in the `pubspace` collection) + one append-only message
// log per room (in the `pubstream` collection, see below). The owner manages the
// registry with their account cap (gated `pubspace:owner`); a link-bearer reads (and,
// with a read/write link, appends room messages) via a member cap the owner minted
// (gated `pubspace:reader`/`pubspace:writer`). See apps/server/src/pubspace-role.ts.
const pubspaceBase = (ownerId: string, spaceId: string) => `pubspaces/${ownerId}/${spaceId}`;
export const pubspaceRoomsName = (ownerId: string, spaceId: string) => `${pubspaceBase(ownerId, spaceId)}/_rooms`;
export const pubspaceRoomsPull = (ownerId: string, spaceId: string) => pull(pubspaceRoomsName(ownerId, spaceId));
export const pubspaceRoomsPush = (ownerId: string, spaceId: string) => push(pubspaceRoomsName(ownerId, spaceId));

// ── Self-service webhook registry (per public space) ──────────────────────────
// One owner-written doc per space mapping a webhookId → { tokenHash, roomId, … }.
// Lets a space OWNER mint their own inbound webhooks without an operator: the app
// writes this registry with the owner's account cap (gated `pubspace:owner`), and
// the server's inbound /webhook route reads it in-process to authenticate a caller
// by hashed token. Only a hash is stored — never the raw token. Keep in sync with
// the `webhooks` collection in apps/server.
export const pubspaceWebhooksName = (ownerId: string, spaceId: string) => `${pubspaceBase(ownerId, spaceId)}/_webhooks`;
export const pubspaceWebhooksPull = (ownerId: string, spaceId: string) => pull(pubspaceWebhooksName(ownerId, spaceId));
export const pubspaceWebhooksPush = (ownerId: string, spaceId: string) => push(pubspaceWebhooksName(ownerId, spaceId));

// ── Public room messages (plaintext, append-only) ─────────────────────────────
// Since `stream` and `channel` merged, EVERY public room's messages live in a
// `streams/` subtree under the owner's space, in the append-only `pubstream`
// collection (no merge-doc `pubspace` message doc anymore — `pubspace` now holds
// only the `_rooms` registry + object index). A writer/bot posts by APPENDING here
// (POST /push, no pull/merge), authorized by a `createPublicLink` audience cap (see
// stream-bots.ts). Keep in sync with the `pubstream` collection in apps/server.
export const pubstreamRoomName = (ownerId: string, spaceId: string, roomId: string) =>
  `pubspaces/${ownerId}/${spaceId}/streams/${roomId}`;
export const pubstreamRoomPull = (ownerId: string, spaceId: string, roomId: string) =>
  pull(pubstreamRoomName(ownerId, spaceId, roomId));
export const pubstreamRoomPush = (ownerId: string, spaceId: string, roomId: string) =>
  push(pubstreamRoomName(ownerId, spaceId, roomId));

// ── DM inbox (per-recipient invite delivery, TIME-SHARDED per user) ───────────
// The cross-space DELIVERY channel behind the shareable "DM me" link: anyone may
// anonymously APPEND a DM invite (sealed to the owner's published KEM key) to the
// owner's inbox, and the owner's reconciler pulls + trial-unseals it (see
// dm-link.ts / dm-inbox.ts). Reads are owner-only (the collection's `{identity}`
// binding); writes are open by design — the link is identity-derived and permanent.
//
// The inbox is sharded by UTC MONTH (`dminbox/{ownerId}/{shard}`): a sender always
// writes the CURRENT month's shard, and the owner scans the current + previous
// shard. This bounds the damage of a flood — the per-shard append cap can only be
// hit for the current month, and the shard self-heals at the next month boundary —
// so a spammer cannot PERMANENTLY brick delivery (an append-only log has no client
// trim, and the identity-link design has no rotation). Keep the path + shard
// convention in sync with the `dminbox` collection in apps/server.
export const dminboxName = (ownerId: string, shard: string) => `dminbox/${ownerId}/${shard}`;
export const dminboxPull = (ownerId: string, shard: string) => pull(dminboxName(ownerId, shard));
export const dminboxPush = (ownerId: string, shard: string) => push(dminboxName(ownerId, shard));

/** The inbox shard id for a moment in time: UTC `YYYY-MM`. UTC (not local) so a
 *  sender and the owner on different devices/timezones always agree on the shard. */
export const dmInboxShard = (d: Date = new Date()): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** The shards the owner must scan: the current month plus the previous one, so an
 *  invite delivered near a month boundary is still seen on the next reconcile.
 *  `Date.UTC(y, m-1, 1)` wraps January → previous December correctly. */
export function dmInboxShards(d: Date = new Date()): string[] {
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return [dmInboxShard(d), dmInboxShard(prev)];
}

// ── Public-space directory index (server-maintained projection) ───────────────
// A read-only list document the server keeps up to date via the `starfish-projection`
// plugin: every `pubspace` `_rooms` write folds the public space's `{ name, ownerId,
// image, rooms }` into this one list. `readRoles: ["public"]`, so it's pulled with NO
// cap (anonymous). The `{shard}` is the space type — only `public` is materialized;
// see the `spaceindex` collection in apps/server + Infra collections.py.
export const spaceIndexName = (shard: 'public') => `_index/spaces/${shard}`;
export const spaceIndexPull = (shard: 'public') => pull(spaceIndexName(shard));

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
    collections: ['profile', 'devices', 'spaces', 'rooms', 'pubspace', 'dminbox'],
    paths: [
      `user/${userId}/profile`,
      `users/${userId}/_devices`,
      `user/${userId}/_spaces`,
      'spaces/**',
      // The owner's own public spaces — server grants `pubspace:owner` because this is
      // a device cap (auth.identity = issUserId = userId = the {ownerId} segment).
      `pubspaces/${userId}/**`,
      // The owner's own DM inbox (every month shard) — read is `cap:read:dminbox`
      // with the collection's `{identity}` binding (the same own-doc gate as `_spaces`).
      `dminbox/${userId}/**`,
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
    collections: ['chat', 'profile', 'devices', 'spaces', 'rooms', 'pubspace', 'dminbox'],
    paths: [
      'spaces/**',
      `user/${userId}/profile`,
      `users/${userId}/_devices`,
      `user/${userId}/_spaces`,
      `pubspaces/${userId}/**`,
      // The DM inbox, every month shard (see accountScope). Devices paired BEFORE
      // this path shipped keep their old cap until re-paired — the inbox scan
      // tolerates the resulting 403 (acceptance lands on the root device anyway,
      // whose keys the invites seal to).
      `dminbox/${userId}/**`,
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

/** The canonical OctoChat identity derivation: `userId = sha256(edPub)[0:32]` (hex).
 *  One home for it — the public-invite ephemeral subject (`pubspace.ts`), the "DM me"
 *  link binding (`dm-link.ts`) and the matching server-side check all share this so a
 *  derivation tweak can never drift between them. Mirrors the userId the Starfish
 *  identities SDK assigns a bootstrapped root. */
export async function userIdFromEdPub(edPubHex: string): Promise<string> {
  const bytes = new Uint8Array(edPubHex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(edPubHex.slice(i * 2, i * 2 + 2), 16);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest)).slice(0, 32);
}
