/**
 * Collection path + cap-scope helpers for OctoChat.
 *
 * Paths are signed relative to SYNC_BASE; the server mounts the sync router at
 * root, so they start with /pull or /push. Everything for a space is nested under
 * `spaces/{spaceId}/…` so the `{spaceId}` segment gates it all uniformly through the
 * space:owner/space:member enricher, and a single `spaces/{spaceId}/**` member cap
 * covers a whole space.
 *
 * **Generic object collections** are provided by `@drakkar.software/octospaces-sdk`
 * (re-exported through OctoChat's index). This module adds OctoChat-specific helpers:
 *
 * - Stream collections (`streamchat`, `streampub`, `streaminv`) — three tiers:
 *     streamchat:  private or invite+enc rooms (E2EE, space:member)
 *     streampub:   public rooms (plaintext, world-readable writes by space:member)
 *     streaminv:   invite+plaintext rooms (cap-gated `[]`/`[]`, per-node cap only)
 * - DM inbox (`dminbox`) — time-sharded delivery channel for cross-space DMs
 * - Webhook registry (`webhooks`) — owner-written per-space hook registry
 * - Space directory (`spaceindex`) — server-maintained public-space projection
 *
 * `OBJECT_COLLECTIONS` and all object/keyring/registry path helpers are consumed
 * from `@drakkar.software/octospaces-sdk`'s paths export.
 *
 * **`streaminv` is intentionally EXCLUDED from `CHAT_COLLECTIONS` / `spaceMemberScope`** —
 * only a per-node `nodeRoomScope` cap can reach it (like `objinv` / `nodeMemberScope`).
 */
import type { ScopePreset } from '@drakkar.software/starfish-identities';
import { OBJECT_COLLECTIONS } from '@drakkar.software/octospaces-sdk';

/**
 * Request-path helpers. These emit the bare action path (`/pull/…`, `/push/…`);
 * the StarfishClient's `namespace` option prepends `/v1/<namespace>` (deployed) for
 * BOTH the URL and the signed canonical path.
 */
const pull = (rest: string) => `/pull/${rest}`;
const push = (rest: string) => `/push/${rest}`;

/** A room id is `sp-<rand>-<name>`; the space is its first two `-` segments. */
export const spaceIdFromRoomId = (roomId: string) => roomId.split('-').slice(0, 2).join('-');

// ── Private / E2EE room messages (streamchat) ─────────────────────────────────
// Covers `access:'space'` rooms (encrypted or not) and `access:'invite'+enc:true`
// rooms (enc invites grant space membership, so the bearer is a `space:member`).
// Storage: `spaces/{spaceId}/streams/{roomId}`. Keep in sync with `streamchat`
// in apps/server/src/config.ts + Infra collections.py.
export const streamRoomName = (roomId: string) =>
  `spaces/${spaceIdFromRoomId(roomId)}/streams/${roomId}`;
export const streamRoomPull = (roomId: string) => pull(streamRoomName(roomId));
export const streamRoomPush = (roomId: string) => push(streamRoomName(roomId));

// ── Public room messages (streampub) ─────────────────────────────────────────
// `access:'public' + enc:false` rooms. World-readable; writes are `space:member`.
// Storage: `spaces/{spaceId}/streams/pub/{roomId}`. The `pub` segment is reserved
// (room ids are `sp-…` and never bare `pub`). Keep in sync with `streampub` in
// apps/server/src/config.ts + Infra collections.py.
export const streamPubRoomName = (roomId: string) =>
  `spaces/${spaceIdFromRoomId(roomId)}/streams/pub/${roomId}`;
export const streamPubRoomPull = (roomId: string) => pull(streamPubRoomName(roomId));
export const streamPubRoomPush = (roomId: string) => push(streamPubRoomName(roomId));

// ── Invite-plaintext room messages (streaminv) ────────────────────────────────
// `access:'invite' + enc:false` rooms. Cap-gated (`read:[] write:[]` server-side);
// only a `nodeRoomScope` per-node cap reaches this path. The `n` segment is reserved;
// `log` is the leaf (mirrors `objinv`'s `n/{nodeId}/content` pattern).
// Storage: `spaces/{spaceId}/streams/n/{roomId}/log`. Keep in sync with `streaminv`
// in apps/server/src/config.ts + Infra collections.py.
export const streamInvRoomName = (roomId: string) =>
  `spaces/${spaceIdFromRoomId(roomId)}/streams/n/${roomId}/log`;
export const streamInvRoomPull = (roomId: string) => pull(streamInvRoomName(roomId));
export const streamInvRoomPush = (roomId: string) => push(streamInvRoomName(roomId));

// ── Space access record (spaceregistry) ──────────────────────────────────────
// Owner-written doc holding `{owner, members, name, image}`. The server's TOFU
// enricher reads this to grant `space:owner`/`space:member`. Keep in sync with
// the `spaceregistry` collection storagePath `spaces/{spaceId}/_access` in
// apps/server/src/config.ts + Infra collections.py.
export const spaceRegistryName = (spaceId: string) => `spaces/${spaceId}/_access`;
export const spaceRegistryPull = (spaceId: string) => pull(spaceRegistryName(spaceId));
export const spaceRegistryPush = (spaceId: string) => push(spaceRegistryName(spaceId));

// ── Webhook registry (webhooks) ───────────────────────────────────────────────
// Owner-written doc mapping webhookId → { tokenHash, roomId, … }. Only a SHA-256
// of the bearer token is stored. The server reads this in-process for the
// `POST /webhook/:spaceId/:webhookId` route. Keep in sync with `webhooks` in
// apps/server/src/config.ts + Infra collections.py.
export const spaceWebhooksName = (spaceId: string) => `spaces/${spaceId}/_webhooks`;
export const spaceWebhooksPull = (spaceId: string) => pull(spaceWebhooksName(spaceId));
export const spaceWebhooksPush = (spaceId: string) => push(spaceWebhooksName(spaceId));

// ── Space-wide keyring (spacekeyring) ─────────────────────────────────────────
// Re-exported from octospaces-sdk; kept here for convenience imports within the SDK.
export { keyringName, keyringPull, keyringPush } from '@drakkar.software/octospaces-sdk';

// ── Object index (objindex) ───────────────────────────────────────────────────
export { objIndexName, objIndexPull, objIndexPush } from '@drakkar.software/octospaces-sdk';

// ── Public node content (objpub) ─────────────────────────────────────────────
export { objPubName, objPubPull, objPubPush } from '@drakkar.software/octospaces-sdk';

// ── Invite-only plaintext node content (objinv) ───────────────────────────────
export { objInvName, objInvPull, objInvPush } from '@drakkar.software/octospaces-sdk';

// ── Attachments (attachments) ─────────────────────────────────────────────────
export { attachmentName, attachmentPull, attachmentPush } from '@drakkar.software/octospaces-sdk';

// ── Profile + registries ──────────────────────────────────────────────────────
export { profilePull, profilePush, spacesPull, spacesPush } from '@drakkar.software/octospaces-sdk';
// NOTE: spaceAccessPull/Push are also exported by octospaces-sdk under those names;
// re-export them so call sites import from this one module.
export { spaceAccessPull, spaceAccessPush } from '@drakkar.software/octospaces-sdk';

// ── DM inbox (dminbox) ────────────────────────────────────────────────────────
// The cross-space DELIVERY channel behind the shareable "DM me" link: anyone may
// anonymously APPEND a DM invite (sealed to the owner's published KEM key) to the
// owner's inbox, and the owner's reconciler pulls + trial-unseals it (see
// dm-link.ts / dm-inbox.ts). Reads are owner-only; writes are open by design.
//
// The inbox is sharded by UTC MONTH (`dminbox/{ownerId}/{shard}`): a sender always
// writes the CURRENT month's shard, and the owner scans the current + previous
// shard. Keep the path + shard convention in sync with `dminbox` in apps/server +
// Infra collections.py.
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

// ── Public-space directory index (spaceindex) ─────────────────────────────────
// A read-only list document the server keeps up to date via the `starfish-projection`
// plugin: every `objindex` write that contains a public node upserts the space into
// this one list. `readRoles: ["public"]`, so it's pulled with NO cap (anonymous).
// The `{shard}` is the index type: `'public'` (public-room directory, maintained by
// the objindex projection) or `'meta'` (name/image for all spaces, maintained by the
// spaceregistry projection). See apps/server/src/projections.ts.
export const spaceIndexName = (shard: 'public' | 'meta') => `_index/spaces/${shard}`;
export const spaceIndexPull = (shard: 'public' | 'meta') => pull(spaceIndexName(shard));

// ── OctoChat collection lists for cap scopes ─────────────────────────────────
/** All OctoChat chat-stream collections eligible for a `space:member` cap.
 *  `streaminv` is intentionally excluded (requires a per-node `nodeRoomScope` cap). */
const CHAT_COLLECTIONS = [...OBJECT_COLLECTIONS, 'streamchat', 'streampub', 'attachments'];

// ── Cap scopes ────────────────────────────────────────────────────────────────

/** Full owner/device access to every space the identity owns. */
export function ownerScope(): ScopePreset {
  return {
    ops: ['read', 'list', 'write'],
    collections: CHAT_COLLECTIONS,
    paths: ['spaces/**'],
  };
}

/**
 * Member access to one SPACE — its keyring, every node's content docs, all room
 * streams, and attachments under `spaces/{spaceId}/**`. Does NOT cover `streaminv`
 * (invite-plaintext streams) — use `nodeRoomScope` for that. One cap covers current
 * AND future rooms. The keyring/access-record WRITE is still `space:owner`-gated
 * server-side; the path reach does not grant write.
 */
export function spaceMemberScope(spaceId: string, canWrite: boolean): ScopePreset {
  const ops: ('read' | 'write' | 'list')[] = canWrite ? ['read', 'list', 'write'] : ['read', 'list'];
  return {
    ops,
    collections: CHAT_COLLECTIONS,
    paths: [`spaces/${spaceId}/**`],
  };
}

/**
 * Narrow per-node cap for `invite+plaintext` rooms. Covers ONLY the room's
 * `streaminv` path at `spaces/{spaceId}/streams/n/{roomId}/**`. Pair with
 * `nodeMemberScope` (for `objinv` content) when the invite also includes object
 * content. The two scopes are unioned into the single invite cap bundle.
 */
export function nodeRoomScope(spaceId: string, roomId: string, canWrite: boolean): ScopePreset {
  const ops: ('read' | 'write' | 'list')[] = canWrite ? ['read', 'list', 'write'] : ['read', 'list'];
  return {
    ops,
    collections: ['streaminv'],
    paths: [`spaces/${spaceId}/streams/n/${roomId}/**`],
  };
}

/**
 * Personal cap for OctoChat: profile + space registry + device directory + all spaces
 * + DM inbox + webhook management. Extends the octospaces-sdk base with OctoChat-only
 * collections (`dminbox`, `webhooks`).
 */
export function accountScope(userId: string): ScopePreset {
  return {
    ops: ['read', 'list', 'write'],
    collections: ['profile', 'devices', 'spaces', 'spaceregistry', 'dminbox', 'webhooks'],
    paths: [
      `user/${userId}/profile`,
      `users/${userId}/_devices`,
      `user/${userId}/_spaces`,
      'spaces/**',
      // The owner's own DM inbox (every month shard) — read is `cap:read:dminbox`
      // with the collection's `{identity}` binding (own-doc gate).
      `dminbox/${userId}/**`,
    ],
  };
}

/**
 * The single cap-cert scope granted to a PAIRED (linked) device. Covers both the
 * chat client (ownerScope) and the account client (accountScope), deduped, because
 * a paired device cannot self-mint — the root device delegates ONE cap-cert here.
 */
export function linkedDeviceScope(userId: string): ScopePreset {
  return {
    ops: ['read', 'list', 'write'],
    collections: [...CHAT_COLLECTIONS, 'profile', 'devices', 'spaces', 'spaceregistry', 'dminbox', 'webhooks'],
    paths: [
      'spaces/**',
      `user/${userId}/profile`,
      `users/${userId}/_devices`,
      `user/${userId}/_spaces`,
      `dminbox/${userId}/**`,
    ],
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

/** The canonical OctoChat identity derivation: `userId = sha256(edPub)[0:32]` (hex). */
export async function userIdFromEdPub(edPubHex: string): Promise<string> {
  const bytes = new Uint8Array(edPubHex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(edPubHex.slice(i * 2, i * 2 + 2), 16);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest)).slice(0, 32);
}
