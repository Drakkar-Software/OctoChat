/**
 * Space + room registries (plaintext metadata docs). A user's spaces live at
 * `user/<userId>/_spaces`; each space's ACCESS RECORD (owner/members + shared
 * name/image) at `spaces/<spaceId>/_rooms`. The room/category LIST no longer lives
 * here — it moved to the encrypted unified object index (`objects/_index`, see
 * `object-index.ts` / {@link useObjects}); `_rooms` is now just the owner-only access
 * record. A fresh identity starts with no spaces — the user creates or joins one.
 */
import { ConflictError, StarfishHttpError } from '@drakkar.software/starfish-client';
import type { StarfishClient } from '@drakkar.software/starfish-client';

import type { CapMap, DmMap, MutePrefs, PubAccessMap, ReadPrefs, Room, Space } from '@/lib/types';

import type { SealedBlob } from './account-seal';

import { randomId } from '../ids';

import type { Session } from './identity';
import { DEFAULT_CATEGORY } from './objects';
import { seedSpaceObjectIndex } from './object-index';
import {
  roomsRegistryPull,
  roomsRegistryPush,
  spacesPull,
  spacesPush,
} from './paths';

// Re-export so existing `import { DEFAULT_CATEGORY } from './registry'` consumers keep
// working; its canonical home is the cycle-free `objects.ts` (shared with object-index).
export { DEFAULT_CATEGORY };

/** Owner-set, SHARED space identity, persisted in the `_rooms` registry doc
 *  (plaintext — NOT E2EE, the same as the name has always been). `image` is a
 *  data URI (see avatar-image). Both optional for back-compat with spaces whose
 *  registry predates this feature. */
export interface SpaceMeta {
  name?: string | null;
  image?: string | null;
}

/** A resolved name/image update fanned out so the SpacesProvider adopts a
 *  freshly-reconciled value (e.g. from the settings screen) without waiting for
 *  its next navigation refresh. */
export interface SpaceMetaUpdate {
  name: string;
  short: string;
  image?: string;
}
const spaceMetaListeners = new Set<(spaceId: string, meta: SpaceMetaUpdate) => void>();
/** Subscribe a live consumer (returns an unsubscribe). */
export function onSpaceMeta(fn: (spaceId: string, meta: SpaceMetaUpdate) => void): () => void {
  spaceMetaListeners.add(fn);
  return () => {
    spaceMetaListeners.delete(fn);
  };
}
export function broadcastSpaceMeta(spaceId: string, meta: SpaceMetaUpdate): void {
  for (const fn of spaceMetaListeners) fn(spaceId, meta);
}

/** The parsed `user/<userId>/_spaces` document: the joined-space list, the durable
 *  member-cap map (see {@link CapMap}), and the per-user mute prefs (see
 *  {@link MutePrefs}) — all three share this one owner-authenticated, synced doc so
 *  a fresh device re-hydrates every piece from the seed in a single pull. */
interface SpacesDoc {
  spaces: Space[];
  caps: CapMap;
  mutes: MutePrefs;
  /** Per-room last-read marks (see {@link ReadPrefs}) — shares this doc like `mutes`
   *  so a fresh device hydrates them in the same pull and unread clears cross-device. */
  reads: ReadPrefs;
  /** Sealed credentials for joined PUBLIC spaces (see {@link PubAccessMap}). Shares
   *  this doc like `caps`, but each value is sealed to the account key first. */
  pubAccess: PubAccessMap;
  /** Peer userId → shared DM-space id (see {@link DmMap}). Shares this doc like `caps`
   *  so DM dedup + the non-initiator's accepted-space pointer hydrate cross-device. */
  dms: DmMap;
  /** The user's quick-reaction emoji palette (see `quick-reactions-settings.ts`). Shares
   *  this doc like `mutes`/`reads` so a fresh device hydrates the palette in the same
   *  pull and an edit on one device propagates cross-device. Stored loosely (a string
   *  array); the strict 6-slot coercion happens at hydrate. */
  quickReactions: string[];
  hash: string | null;
}

/** Coerce a doc's raw `dms` field into a well-formed {@link DmMap} (tolerant of a
 *  missing/garbage value — a doc predating DMs reads back empty). Only string→string
 *  entries survive. */
function coerceDms(raw: unknown): DmMap {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: DmMap = {};
  for (const [k, v] of Object.entries(src)) if (typeof v === 'string') out[k] = v;
  return out;
}

/** Coerce a doc's raw `mutes` field into a well-formed {@link MutePrefs} (tolerant
 *  of a missing/garbage value — an older doc predating mutes reads back as empty). */
function coerceMutes(raw: unknown): MutePrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { rooms?: unknown; spaces?: unknown };
  const pick = (v: unknown): Record<string, true | number> =>
    v && typeof v === 'object' ? (v as Record<string, true | number>) : {};
  return { rooms: pick(r.rooms), spaces: pick(r.spaces) };
}

/** Coerce a doc's raw `reads` field into a well-formed {@link ReadPrefs} (tolerant of
 *  a missing/garbage value — an older doc predating read-sync reads back as empty).
 *  Only finite numbers survive so a corrupt mark can't poison the max-merge. */
function coerceReads(raw: unknown): ReadPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { rooms?: unknown };
  const src = r.rooms && typeof r.rooms === 'object' ? (r.rooms as Record<string, unknown>) : {};
  const rooms: Record<string, number> = {};
  for (const [id, v] of Object.entries(src)) if (typeof v === 'number' && Number.isFinite(v)) rooms[id] = v;
  return { rooms };
}

/** Coerce a doc's raw `quickReactions` field into a string array (tolerant of a
 *  missing/garbage value — a doc predating the feature reads back empty). Loose by
 *  design: the strict 6-slot/positional-default coercion lives in
 *  `quick-reactions-settings.coerce()` and runs at hydrate (kept here to avoid a cycle). */
function coerceQuickReactions(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Pull the raw spaces doc, normalizing its keys. A 404 (no doc yet) returns an
 * empty doc with `hash: null` so a first write can create it. Any OTHER error
 * propagates — callers doing read-modify-write must abort rather than clobber the
 * doc with empty content on a transient failure.
 */
async function pullSpacesDoc(client: StarfishClient, userId: string): Promise<SpacesDoc> {
  const res = await client.pull(spacesPull(userId)).catch((err: unknown) => {
    // No doc yet → an empty doc a first write can create. Other errors propagate.
    if (err instanceof StarfishHttpError && err.status === 404) return null;
    throw err;
  });
  const data = res?.data as
    | {
        spaces?: Space[];
        caps?: CapMap;
        mutes?: unknown;
        reads?: unknown;
        pubAccess?: PubAccessMap;
        dms?: unknown;
        quickReactions?: unknown;
      }
    | undefined;
  return {
    spaces: Array.isArray(data?.spaces) ? data!.spaces! : [],
    caps: data?.caps && typeof data.caps === 'object' ? data.caps : {},
    mutes: coerceMutes(data?.mutes),
    reads: coerceReads(data?.reads),
    pubAccess: data?.pubAccess && typeof data.pubAccess === 'object' ? data.pubAccess : {},
    dms: coerceDms(data?.dms),
    quickReactions: coerceQuickReactions(data?.quickReactions),
    hash: res?.hash ?? null,
  };
}

export async function readSpaces(
  client: StarfishClient,
  userId: string,
): Promise<SpacesDoc> {
  try {
    return await pullSpacesDoc(client, userId);
  } catch (err) {
    // Don't collapse a reachability/auth failure into "no spaces" silently — that
    // reads as an empty account (e.g. a desktop build baked against an unreachable
    // server). Surface it; the caller still degrades to empty.
    console.error('[readSpaces] failed to pull spaces registry', err);
    return { spaces: [], caps: {}, mutes: coerceMutes(undefined), reads: coerceReads(undefined), pubAccess: {}, dms: {}, quickReactions: [], hash: null };
  }
}

/**
 * Read-modify-write the whole `_spaces` doc through a single funnel. The mutator
 * runs on FRESH server state (re-read each attempt) and returns the next
 * `{ spaces, caps, pubAccess }`, so a caller can never accidentally drop a sibling key
 * — it must actively change it. Pushes are retried on {@link ConflictError} (a
 * concurrent writer — e.g. another device, or a cap-save racing a space-list edit) by
 * re-reading and re-applying. This is why caps, pubAccess and the space list can
 * safely share one doc.
 */
export async function updateSpacesDoc(
  client: StarfishClient,
  userId: string,
  mutator: (
    cur: { spaces: Space[]; caps: CapMap; pubAccess: PubAccessMap },
  ) => { spaces: Space[]; caps: CapMap; pubAccess: PubAccessMap },
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { spaces, caps, mutes, reads, pubAccess, dms, quickReactions, hash } = await pullSpacesDoc(client, userId);
    const cur = { spaces, caps, pubAccess };
    const next = mutator(cur);
    if (next === cur) return; // no-op mutation (e.g. already joined) — skip the write
    try {
      // `mutes`, `reads`, `dms` and `quickReactions` are read fresh and threaded through
      // unchanged so a spaces/caps edit never drops a sibling key (the twin of how `caps`
      // is preserved).
      await client.push(
        spacesPush(userId),
        { v: 1, spaces: next.spaces, caps: next.caps, mutes, reads, pubAccess: next.pubAccess, dms, quickReactions },
        hash,
      );
      return;
    } catch (err) {
      if (err instanceof ConflictError && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
}

/**
 * Read-modify-write the `mutes` key of the `_spaces` doc through the same
 * conflict-retrying funnel as {@link updateSpacesDoc}, preserving the sibling
 * `spaces`/`caps` keys. The mutator runs on FRESH server state and returns the next
 * {@link MutePrefs} (or `null` for a no-op, e.g. unmuting something already unmuted).
 */
export async function updateMutesDoc(
  client: StarfishClient,
  userId: string,
  mutator: (cur: MutePrefs) => MutePrefs | null,
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { spaces, caps, mutes, reads, pubAccess, dms, quickReactions, hash } = await pullSpacesDoc(client, userId);
    const next = mutator(mutes);
    if (!next) return; // no-op
    try {
      // Thread `spaces`/`caps`/`reads`/`pubAccess`/`dms`/`quickReactions` through unchanged — a
      // mute edit must never drop a sibling key (the twin of how `mutes` is preserved by updateSpacesDoc).
      await client.push(spacesPush(userId), { v: 1, spaces, caps, mutes: next, reads, pubAccess, dms, quickReactions }, hash);
      return;
    } catch (err) {
      if (err instanceof ConflictError && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
}

/**
 * Read-modify-write the `reads` key of the `_spaces` doc through the same
 * conflict-retrying funnel as {@link updateMutesDoc}, preserving the sibling
 * `spaces`/`caps`/`mutes`/`pubAccess` keys. The mutator runs on FRESH server state and
 * returns the next {@link ReadPrefs} (or `null` for a no-op). Read marks are monotonic,
 * so a mutator MUST max-merge rather than overwrite — that is what makes a stale
 * device's flush unable to roll back a newer mark another device already pushed.
 */
export async function updateReadsDoc(
  client: StarfishClient,
  userId: string,
  mutator: (cur: ReadPrefs) => ReadPrefs | null,
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { spaces, caps, mutes, reads, pubAccess, dms, quickReactions, hash } = await pullSpacesDoc(client, userId);
    const next = mutator(reads);
    if (!next) return; // no-op (nothing newer than the server already has)
    try {
      // Thread `spaces`/`caps`/`mutes`/`pubAccess`/`dms`/`quickReactions` through unchanged — a
      // reads edit must never drop a sibling key (the twin of how `mutes` is preserved by updateSpacesDoc).
      await client.push(spacesPush(userId), { v: 1, spaces, caps, mutes, reads: next, pubAccess, dms, quickReactions }, hash);
      return;
    } catch (err) {
      if (err instanceof ConflictError && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
}

/**
 * Read-modify-write the `dms` key of the `_spaces` doc through the same
 * conflict-retrying funnel as {@link updateMutesDoc}, preserving the sibling
 * `spaces`/`caps`/`mutes`/`reads`/`pubAccess` keys. The mutator runs on FRESH server
 * state and returns the next {@link DmMap} (or `null` for a no-op, e.g. the mapping is
 * already what it would be set to).
 */
export async function updateDmsDoc(
  client: StarfishClient,
  userId: string,
  mutator: (cur: DmMap) => DmMap | null,
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { spaces, caps, mutes, reads, pubAccess, dms, quickReactions, hash } = await pullSpacesDoc(client, userId);
    const next = mutator(dms);
    if (!next) return; // no-op
    try {
      // Thread `spaces`/`caps`/`mutes`/`reads`/`pubAccess`/`quickReactions` through unchanged — a
      // dms edit must never drop a sibling key (the twin of how `mutes` is preserved by updateSpacesDoc).
      await client.push(spacesPush(userId), { v: 1, spaces, caps, mutes, reads, pubAccess, dms: next, quickReactions }, hash);
      return;
    } catch (err) {
      if (err instanceof ConflictError && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
}

/**
 * Read-modify-write the `quickReactions` key of the `_spaces` doc through the same
 * conflict-retrying funnel as {@link updateMutesDoc}, preserving every sibling key. The
 * mutator runs on FRESH server state and returns the next palette (or `null` for a
 * no-op). Last-writer-wins on the array, which only races across a user's own devices.
 */
export async function updateQuickReactionsDoc(
  client: StarfishClient,
  userId: string,
  mutator: (cur: string[]) => string[] | null,
): Promise<void> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { spaces, caps, mutes, reads, pubAccess, dms, quickReactions, hash } = await pullSpacesDoc(client, userId);
    const next = mutator(quickReactions);
    if (!next) return; // no-op
    try {
      // Thread `spaces`/`caps`/`mutes`/`reads`/`pubAccess`/`dms` through unchanged — a palette edit
      // must never drop a sibling key (the twin of how `mutes` is preserved by updateSpacesDoc).
      await client.push(spacesPush(userId), { v: 1, spaces, caps, mutes, reads, pubAccess, dms, quickReactions: next }, hash);
      return;
    } catch (err) {
      if (err instanceof ConflictError && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
}

/** Record `peerUserId → spaceId` in the DM map. Idempotent: a no-op when the peer is
 *  already mapped to this exact space (so it's safe to call on every create/accept).
 *  The min-winner dedup decision (when two competing spaces exist) is made by the
 *  caller (see `dm.ts`); this just persists the chosen mapping. */
export async function setDmMapping(
  client: StarfishClient,
  userId: string,
  peerUserId: string,
  spaceId: string,
): Promise<void> {
  await updateDmsDoc(client, userId, (cur) => (cur[peerUserId] === spaceId ? null : { ...cur, [peerUserId]: spaceId }));
}

/**
 * Replace the joined-space list, preserving the durable `caps` map. Implemented over
 * {@link updateSpacesDoc} so every existing caller is caps-safe with no call-site
 * change; the `caps` are read fresh on write. The prior `hash` is now vestigial (the
 * funnel re-reads) — last-writer-wins on the `spaces` array, which only races across
 * a user's own devices.
 */
export async function writeSpaces(
  client: StarfishClient,
  userId: string,
  spaces: Space[],
  _hash: string | null,
): Promise<void> {
  await updateSpacesDoc(client, userId, (cur) => ({ spaces, caps: cur.caps, pubAccess: cur.pubAccess }));
}

/**
 * Reorder the joined-space list to match `order` (an explicit list of space ids).
 * Mirrors {@link reorderCategories}: the FRESH server array is sorted to follow
 * `order`, then any id NOT in `order` is appended in its existing relative position —
 * so a space joined on another device (or a DM space, which the rail filters out and
 * never lists in `order`) is never orphaned out of the doc. Conflict-retried via
 * {@link updateSpacesDoc}; last-writer-wins on the array, which only races across a
 * user's own devices. A no-op (order already matches) skips the write.
 */
export async function reorderSpaces(
  client: StarfishClient,
  userId: string,
  order: string[],
): Promise<void> {
  await updateSpacesDoc(client, userId, (cur) => {
    const byId = new Map(cur.spaces.map((s) => [s.id, s]));
    const next: Space[] = [];
    for (const id of order) {
      const s = byId.get(id);
      if (s) {
        next.push(s);
        byId.delete(id);
      }
    }
    // Append anything `order` didn't mention (DMs, or a space joined elsewhere),
    // preserving the fresh array's relative order for those tail entries.
    for (const s of cur.spaces) if (byId.has(s.id)) next.push(s);
    const unchanged = next.length === cur.spaces.length && next.every((s, i) => s === cur.spaces[i]);
    if (unchanged) return cur; // no-op — updateSpacesDoc skips the push
    return { spaces: next, caps: cur.caps, pubAccess: cur.pubAccess };
  });
}

/** Opaque, dedicated space id — independent of any userId. Ownership is recorded
 *  in the registry doc's `owner` field, not derivable from the id. Unguessable
 *  (CSPRNG): the server grants the first writer of `spaces/<id>/_rooms` ownership,
 *  so a predictable id would let an attacker pre-claim a not-yet-created space. */
function newSpaceId(): string {
  return `sp-${randomId()}`;
}

/** The ordered category list for a space. The stored `categories` array (when
 *  present) is authoritative; absent it, derive it from the distinct `room.category`
 *  values in document order so a pre-feature registry reads back identically. Any
 *  room category missing from a stored list is appended (defensive — never orphans a
 *  room into an unrendered bucket). */
export function normalizeCategories(rooms: Room[], stored: unknown): string[] {
  const distinct: string[] = [];
  for (const r of rooms) if (r.category && !distinct.includes(r.category)) distinct.push(r.category);
  const list = Array.isArray(stored) ? stored.filter((c): c is string => typeof c === 'string') : [];
  if (!list.length) return distinct;
  const result = [...list];
  for (const c of distinct) if (!result.includes(c)) result.push(c);
  return result;
}

/**
 * Read a space's `_rooms` ACCESS RECORD: owner, member roster, and the shared
 * name/image. The room/category LIST is no longer here (it lives in the encrypted
 * object index — see {@link readIndexRooms}); this returns only what gates access +
 * the plaintext shared identity.
 */
export async function readRooms(
  client: StarfishClient,
  spaceId: string,
): Promise<{
  owner: string | null;
  members: string[];
  name: string | null;
  image: string | null;
  hash: string | null;
}> {
  // 404 (no registry yet) → an empty doc a first write can create; any OTHER error
  // (offline / unreachable) PROPAGATES so a caller — the rooms provider, or a write
  // RMW — can tell "empty space" from "couldn't reach the server" instead of silently
  // collapsing to no-access. Mirrors pullSpacesDoc.
  const res = await client.pull(roomsRegistryPull(spaceId)).catch((err: unknown) => {
    if (err instanceof StarfishHttpError && err.status === 404) return null;
    throw err;
  });
  const data = res?.data as
    | { owner?: string; members?: unknown[]; name?: string; image?: string }
    | undefined;
  return {
    owner: typeof data?.owner === 'string' ? data.owner : null,
    members: Array.isArray(data?.members)
      ? data!.members!.filter((m): m is string => typeof m === 'string')
      : [],
    name: typeof data?.name === 'string' ? data.name : null,
    image: typeof data?.image === 'string' ? data.image : null,
    hash: res?.hash ?? null,
  };
}

export async function writeRooms(
  client: StarfishClient,
  spaceId: string,
  owner: string,
  members: string[],
  hash: string | null,
  meta?: SpaceMeta,
): Promise<void> {
  // The `_rooms` doc is now just the ACCESS RECORD `{ v, owner, members, name, image }`
  // (the room/category list moved to the encrypted object index). `owner` + `members`
  // are the authoritative access record the server's space:owner/space:member enricher
  // reads to gate this registry and the space keyring — stamp both on every write so
  // neither is ever dropped. `name`/`image` are the shared space identity; callers thread
  // the values they read back through so a write never drops them. A falsy value is
  // omitted — that's how the owner clears the image.
  const name = meta?.name?.trim() || undefined;
  const image = meta?.image || undefined;
  await client.push(
    roomsRegistryPush(spaceId),
    {
      v: 1,
      owner,
      members,
      ...(name ? { name } : {}),
      ...(image ? { image } : {}),
    },
    hash,
  );
}

/** Owner-side: add an invitee's userId to the space roster → grants them
 *  `space:member` (read the registry + the space keyring). Idempotent. */
export async function addSpaceMember(
  client: StarfishClient,
  spaceId: string,
  ownerUserId: string,
  memberUserId: string,
): Promise<void> {
  const { owner, members, name, image, hash } = await readRooms(client, spaceId);
  if (memberUserId === (owner ?? ownerUserId) || members.includes(memberUserId)) return;
  // Push replaces the whole access-record doc; thread name/image through so adding a
  // member never drops the shared space identity (see writeRooms).
  await writeRooms(client, spaceId, owner ?? ownerUserId, [...members, memberUserId], hash, { name, image });
}

/** Invitee-side: record a joined space in the identity's own space list. Caps are
 *  left untouched (used for public joins, which carry no member cap). Idempotent. */
export async function addJoinedSpace(client: StarfishClient, userId: string, space: Space): Promise<void> {
  await updateSpacesDoc(client, userId, (cur) =>
    cur.spaces.some((s) => s.id === space.id)
      ? cur
      : { spaces: [...cur.spaces, space], caps: cur.caps, pubAccess: cur.pubAccess },
  );
}

/**
 * Invitee-side: record a joined PRIVATE space AND persist its member cap in one
 * atomic doc write. Storing the cap in the user's own (seed-authenticated) `_spaces`
 * doc is what lets a fresh device re-hydrate it and self-heal — the cap is owner-
 * issued and not re-derivable, and it is not a secret (Starfish binds every request
 * to a fresh signature over `cap.sub`, so a stored cap is useless without the
 * member's private key). Idempotent on the space; the cap is always (re)written.
 */
export async function addJoinedSpaceWithCap(
  client: StarfishClient,
  userId: string,
  space: Space,
  capJson: string,
): Promise<void> {
  await updateSpacesDoc(client, userId, (cur) => ({
    spaces: cur.spaces.some((s) => s.id === space.id) ? cur.spaces : [...cur.spaces, space],
    caps: { ...cur.caps, [space.id]: capJson },
    pubAccess: cur.pubAccess,
  }));
}

/**
 * Invitee-side: record a joined PUBLIC space AND persist its sealed access credential
 * in one atomic doc write — the public twin of {@link addJoinedSpaceWithCap}. Unlike a
 * private member cap, a public-join credential embeds a bearer secret (the link's
 * ephemeral key), so the caller seals it to the account key first (see
 * `account-seal.ts`); only the seed can re-open it. Idempotent on the space; the
 * sealed access is always (re)written so a re-join refreshes a rotated link.
 */
export async function addJoinedPublicSpaceWithAccess(
  client: StarfishClient,
  userId: string,
  space: Space,
  sealed: SealedBlob,
): Promise<void> {
  await updateSpacesDoc(client, userId, (cur) => ({
    spaces: cur.spaces.some((s) => s.id === space.id) ? cur.spaces : [...cur.spaces, space],
    caps: cur.caps,
    pubAccess: { ...cur.pubAccess, [space.id]: sealed },
  }));
}

/**
 * Create a new space (+ a seeded "general" channel) owned by the identity. Takes the
 * full {@link Session} because seeding the channel now means writing the ENCRYPTED object
 * index (the `_rooms` doc holds only the access record): claim ownership in `_rooms`
 * first (so `space:owner` is satisfied), then mint the space keyring + push the encrypted
 * seed node for `general`. With the on-device `_rooms`→index migration removed, this is
 * the only thing that seeds a freshly-created space's room list.
 */
export async function createSpace(session: Session, name: string): Promise<Space> {
  const { accountClient, userId } = session;
  const { spaces, hash } = await readSpaces(accountClient, userId);
  const trimmed = name.trim() || 'New Space';
  const id = newSpaceId();
  const space: Space = { id, name: trimmed, short: trimmed.slice(0, 2).toUpperCase(), members: 1 };
  // Order matters for crash-safety. Stamp ownership first (TOFU: this first write claims
  // the space + the shared name) so the keyring write below passes `space:owner`, then
  // seed the encrypted object index with one `general` channel (mints the keyring). Only
  // once the space is fully formed do we add it to the user's `_spaces` list — so a failed
  // seed leaves an unreferenced (harmless, unguessable-id) `_rooms`/keyring orphan rather
  // than a space that shows up EMPTY in the rail (with the migration gone, nothing would
  // ever re-seed it).
  await writeRooms(accountClient, id, userId, [], null, { name: trimmed });
  await seedSpaceObjectIndex(session, id, [{ id: `${id}-general`, name: 'general', kind: 'channel', category: DEFAULT_CATEGORY }]);
  await writeSpaces(accountClient, userId, [...spaces, space], hash);
  return space;
}

/** A user-facing category validation failure (empty/duplicate name). The hook layer
 *  surfaces `message` verbatim, unlike an opaque network/HTTP error. */
export class CategoryError extends Error {}

/**
 * Member/read side: fold the SHARED name/image (read from the space's `_rooms`
 * registry) into this identity's own `_spaces` cache so the rails + header reflect
 * an owner's edit. Shared values win when present; absent shared values keep the
 * local one (back-compat for pre-feature registries). A no-op when already in
 * sync, so it's cheap to call on every space open. Broadcasts so a live `useSpaces`
 * updates without waiting for its next navigation refresh.
 *
 * `knownSpaces` (the caller's already-loaded space list) lets the common case —
 * meta already in sync — short-circuit BEFORE any network read. Without it this
 * fired a `_spaces` GET on every single space/room open even when nothing changed.
 */
export async function reconcileSpaceMeta(
  client: StarfishClient,
  userId: string,
  spaceId: string,
  shared: SpaceMeta,
  knownSpaces?: Space[],
): Promise<void> {
  const sharedName = typeof shared.name === 'string' && shared.name.trim() ? shared.name : null;
  const sharedImage = typeof shared.image === 'string' && shared.image ? shared.image : null;
  if (sharedName === null && sharedImage === null) return; // nothing shared to apply
  // Fast path: if the caller's snapshot already matches the shared meta, there is
  // nothing to write — skip the read + write entirely (the usual case on open).
  const known = knownSpaces?.find((s) => s.id === spaceId);
  if (known) {
    const name = sharedName ?? known.name;
    const short = name.slice(0, 2).toUpperCase();
    const image = sharedImage ?? known.image;
    if (name === known.name && short === known.short && (image ?? null) === (known.image ?? null)) return;
  }
  const { spaces, hash } = await readSpaces(client, userId);
  const cur = spaces.find((s) => s.id === spaceId);
  if (!cur) return;
  const name = sharedName ?? cur.name;
  const image = sharedImage ?? cur.image;
  const short = name.slice(0, 2).toUpperCase();
  if (name === cur.name && short === cur.short && (image ?? null) === (cur.image ?? null)) return;
  const next = spaces.map((s) => (s.id === spaceId ? { ...s, name, short, image } : s));
  await writeSpaces(client, userId, next, hash);
  broadcastSpaceMeta(spaceId, { name, short, image });
}
