/**
 * PUBLIC spaces — plaintext, cap-only spaces joined via a self-sufficient,
 * space-wide invitation link.
 *
 * Unlike a private space (E2EE keyring + encrypted `inviteToSpace` join), a public
 * space lives entirely in the plaintext `pubspaces/{ownerId}/{spaceId}/…` subtree:
 * a `_rooms` registry doc + one plaintext message doc per room. Access is authorized
 * purely by a member cap the owner SIGNS — no keyring. The recipient is unknown in
 * advance, so the cap is minted against a THROWAWAY ephemeral keypair and BOTH the
 * owner-signed cap and that ephemeral private key are packed into the link's URL
 * fragment. The link itself is the credential and grants access to EVERY room in the
 * space (read-only or read/write). NOT end-to-end encrypted — the server can read it.
 */
import { generateDeviceKeys } from '@drakkar.software/starfish-identities';
import { mintMemberCap } from '@drakkar.software/starfish-sharing';
import { ConflictError, StarfishHttpError } from '@drakkar.software/starfish-client';
import type { StarfishClient } from '@drakkar.software/starfish-client';

import type { PubAccessMap, Room, RoomKind, Space } from '@/lib/types';

import { randomId, roomSlug } from '../ids';

import { sealToSelf, unsealFromSelf } from './account-seal';
import type { SealedBlob } from './account-seal';
import { makeClient } from './client';
import type { Session } from './identity';
import { bytesToHex, pubspaceRoomPush, pubspaceRoomsPull, pubspaceRoomsPush, pubspaceScope } from './paths';
import {
  getPubspaceAccess,
  localPubspaceEntries,
  mergePubspaceAccess,
  savePubspaceAccess,
} from './pubspace-caps';
import type { AccessMap, PubspaceAccess } from './pubspace-caps';
import {
  addJoinedPublicSpaceWithAccess,
  addJoinedSpace,
  DEFAULT_CATEGORY,
  normalizeCategories,
  updateSpacesDoc,
} from './registry';

/** Everything a joiner needs, packed into the invitation link's URL fragment. */
export interface PublicInviteToken {
  ownerId: string;
  spaceId: string;
  spaceName: string;
  /** The owner-signed member cap-cert (CapCert). */
  cap: unknown;
  /** The throwaway ephemeral subject's Ed25519 private key (hex). */
  key: string;
  /** Read/write link (true) or read-only (false). */
  write: boolean;
}

// ── base64url for the link fragment (UTF-8 safe, web + native) ────────────────
function toBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(json, 'utf-8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(b64, 'base64').toString('utf-8');
}

/** Pack an invite into a `/join#…` link. The credential rides in the fragment
 *  (`#…`), which browsers never send to the server, put in `Referer`, or log. */
export function encodePublicInviteLink(origin: string, token: PublicInviteToken): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/join#${toBase64Url(JSON.stringify(token))}`;
}

/** Decode the token from a `#…` fragment (with or without the leading `#`). */
export function decodePublicInvite(fragment: string): PublicInviteToken {
  const frag = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  const tok = JSON.parse(fromBase64Url(frag)) as Partial<PublicInviteToken>;
  if (!tok || !tok.ownerId || !tok.spaceId || !tok.cap || !tok.key) {
    throw new Error('That public invite link is malformed or incomplete.');
  }
  return {
    ownerId: tok.ownerId,
    spaceId: tok.spaceId,
    spaceName: tok.spaceName ?? 'Public space',
    cap: tok.cap,
    key: tok.key,
    write: !!tok.write,
  };
}

/** Opaque public-space id; ownership is recorded by the `{ownerId}` storage path.
 *  CSPRNG-backed so it can't be predicted (see `@/lib/ids`). */
function newPublicSpaceId(): string {
  return `psp-${randomId()}`;
}

const monogram = (name: string) => name.trim().slice(0, 2).toUpperCase() || 'PS';

/** The cap subject's userId, mirroring the SDK derivation: SHA-256(edPub), first
 *  32 hex chars. Reproduced here so a randomly-generated throwaway keypair gets a
 *  matching, self-consistent identity without a slow Argon2 root bootstrap. */
async function ephemeralUserId(edPubHex: string): Promise<string> {
  const bytes = new Uint8Array(edPubHex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(edPubHex.slice(i * 2, i * 2 + 2), 16);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest)).slice(0, 32);
}

interface PublicRoomsDoc {
  v: 1;
  rooms: Room[];
  /** Owner-set shared space identity (plaintext, like the rest of a public space).
   *  Joiners read it; `pubspace:writer` is withheld on `_rooms`, so only the owner
   *  writes it. `image` is a data URI (see avatar-image). */
  name?: string;
  image?: string;
  /** Ordered category list — mirrors the private registry (see normalizeCategories).
   *  Omitted when empty so a pre-feature public space stays byte-identical. */
  categories?: string[];
}

/** Public-space ids are prefixed so the data layer can branch synchronously without
 *  fetching the space record (the `type` field on the record stays authoritative for
 *  display). Kept in sync with `newPublicSpaceId`. */
export const isPublicSpaceId = (spaceId: string): boolean => spaceId.startsWith('psp-');

/** Auth (cap + signing key) + ownerId + write for a public space, derived from the
 *  stored invite (a joiner) or — when none is stored — this identity as the owner. */
export function publicSpaceAuth(
  session: Session,
  spaceId: string,
): { cap: unknown; signingKey: string; ownerId: string; write: boolean } {
  const access = getPubspaceAccess(spaceId);
  if (access) return { cap: access.cap, signingKey: access.key, ownerId: access.ownerId, write: access.write };
  // No stored invite ⇒ we are the owner; manage it with the account cap.
  return { cap: session.accountCap, signingKey: session.keys.edPriv, ownerId: session.userId, write: true };
}

/** An empty plaintext room doc — same shape `useSyncInit` builds, minus encryption. */
const emptyRoomDoc = (): Record<string, unknown> => ({ messages: [], reactions: [] });

/** Read a public space's room registry doc — rooms, shared name/image, + its hash
 *  (for an append write). */
export async function readPublicRoomsDoc(
  client: StarfishClient,
  ownerId: string,
  spaceId: string,
): Promise<{ rooms: Room[]; name: string | null; image: string | null; categories: string[]; hash: string | null }> {
  // 404 → empty doc; any other error (offline) propagates so the rooms provider can
  // fall back to the cached registry instead of wiping the list. Twin of readRooms.
  const res = await client.pull(pubspaceRoomsPull(ownerId, spaceId)).catch((err: unknown) => {
    if (err instanceof StarfishHttpError && err.status === 404) return null;
    throw err;
  });
  const data = res?.data as Partial<PublicRoomsDoc> | undefined;
  const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
  return {
    rooms,
    name: typeof data?.name === 'string' ? data.name : null,
    image: typeof data?.image === 'string' ? data.image : null,
    categories: normalizeCategories(rooms, data?.categories),
    hash: res?.hash ?? null,
  };
}

/** Read a public space's room list (gated by the caller's cap). */
export async function readPublicRooms(client: StarfishClient, ownerId: string, spaceId: string): Promise<Room[]> {
  return (await readPublicRoomsDoc(client, ownerId, spaceId)).rooms;
}

/**
 * Owner: create a new PUBLIC space. Seeds a `general` room into the plaintext
 * `_rooms` registry (written with the account cap → `pubspace:owner`) and registers
 * the space in the owner's own `_spaces` list as `type:'public'`.
 */
export async function createPublicSpace(session: Session, name: string): Promise<Space> {
  const trimmed = name.trim() || 'Public space';
  const spaceId = newPublicSpaceId();
  const general: Room = { id: `${spaceId}-general`, spaceId, category: 'CHANNELS', name: 'general', kind: 'channel' };
  const doc: PublicRoomsDoc = { v: 1, rooms: [general], name: trimmed };
  await session.accountClient.push(
    pubspaceRoomsPush(session.userId, spaceId),
    doc as unknown as Record<string, unknown>,
    null,
  );
  // Seed the room's empty message doc so a reader's first pull finds it (no 404).
  await session.accountClient.push(pubspaceRoomPush(session.userId, spaceId, general.id), emptyRoomDoc(), null);
  const space: Space = {
    id: spaceId,
    name: trimmed,
    short: monogram(trimmed),
    members: 1,
    type: 'public',
    ownerId: session.userId,
    write: true,
  };
  await addJoinedSpace(session.accountClient, session.userId, space);
  return space;
}

/**
 * Owner: mint a space-wide invitation link for a public space. `write` chooses a
 * read-only or read/write link. `origin` is the app's web origin (the caller passes
 * `window.location.origin` on web).
 */
export async function createPublicInvite(
  session: Session,
  spaceId: string,
  spaceName: string,
  write: boolean,
  origin: string,
): Promise<{ token: PublicInviteToken; link: string }> {
  // A throwaway ephemeral keypair, generated RANDOMLY. We deliberately do NOT
  // bootstrap a root identity from a mnemonic here: that runs Argon2id, which —
  // under the web pure-JS shim — blocks the main thread for seconds and freezes
  // the UI. The subject userId mirrors the SDK derivation (SHA-256(edPub)) so the
  // minted cap is self-consistent.
  const ek = generateDeviceKeys();
  const userIdHex = await ephemeralUserId(ek.edPub);
  const cap = await mintMemberCap(
    session.keys.edPriv,
    session.keys.edPub,
    { edPubHex: ek.edPub, kemPubHex: ek.kemPub, userIdHex },
    'pubspace',
    pubspaceScope(session.userId, spaceId, write),
  );
  const token: PublicInviteToken = { ownerId: session.userId, spaceId, spaceName, cap, key: ek.edPriv, write };
  return { token, link: encodePublicInviteLink(origin, token) };
}

/**
 * Joiner: accept a public invite link — store its cap+key and register the space in
 * this identity's own `_spaces` list. No keyring check (there is none). Idempotent.
 */
export async function joinPublicSpace(session: Session, token: PublicInviteToken): Promise<Space> {
  const access: PubspaceAccess = { ownerId: token.ownerId, cap: token.cap, key: token.key, write: token.write };
  savePubspaceAccess(token.spaceId, access); // device-local: keeps reads synchronous here
  const name = token.spaceName.trim() || `public-${token.spaceId.slice(-6)}`;
  const space: Space = {
    id: token.spaceId,
    name,
    short: monogram(name),
    members: 1,
    type: 'public',
    ownerId: token.ownerId,
    write: token.write,
  };
  // Seal the credential to the account key and persist it in the synced `_spaces` doc
  // (atomically with the space) so the user's OTHER devices recover access WITHOUT
  // re-opening the link — the public twin of how a private member cap self-heals.
  const sealed = await sealToSelf(session, JSON.stringify(access));
  await addJoinedPublicSpaceWithAccess(session.accountClient, session.userId, space, sealed);
  return space;
}

/**
 * Sign-in orchestrator: reconcile this device's public-space access with the synced
 * `_spaces` doc (its sealed `pubAccess` map). Two halves, both best-effort:
 *
 * - RECOVER — unseal every server entry into the in-memory + kv cache, so a device
 *   that never opened the invite link gains read/write access to a public space it
 *   already sees in its list.
 * - BACKFILL — seal any device-local-only entry missing from the server doc and upload
 *   it in ONE batched write, so spaces this device joined before the credential synced
 *   propagate to the user's other devices (no re-join needed). This is what heals an
 *   account that joined public spaces on web/desktop before this feature shipped.
 *
 * Failures are logged, not thrown: access still works from whatever is cached locally.
 */
export async function recoverPubspaceAccess(session: Session, serverPubAccess: PubAccessMap): Promise<void> {
  // 1. RECOVER: unseal server entries → merge over the local cache (server wins).
  const recovered: AccessMap = {};
  for (const [spaceId, sealed] of Object.entries(serverPubAccess)) {
    try {
      recovered[spaceId] = JSON.parse(await unsealFromSelf(session, sealed)) as PubspaceAccess;
    } catch (e) {
      console.error('[OctoChat] pubspace recover: failed to unseal', spaceId, e);
    }
  }
  mergePubspaceAccess(recovered);

  // 2. BACKFILL: local-only entries the server doc doesn't have yet → seal + upload.
  const local = localPubspaceEntries();
  const missing = Object.keys(local).filter((id) => !(id in serverPubAccess));
  if (missing.length === 0) return;
  try {
    const sealedEntries: Record<string, SealedBlob> = {};
    for (const id of missing) sealedEntries[id] = await sealToSelf(session, JSON.stringify(local[id]));
    await updateSpacesDoc(session.accountClient, session.userId, (cur) => ({
      spaces: cur.spaces,
      caps: cur.caps,
      pubAccess: { ...cur.pubAccess, ...sealedEntries },
    }));
  } catch (e) {
    console.error('[OctoChat] pubspace backfill failed', e);
  }
}

/** A client authenticated for a public space (owner's account cap or joiner's link cap). */
export function publicSpaceClient(session: Session, spaceId: string): StarfishClient {
  const auth = publicSpaceAuth(session, spaceId);
  return makeClient(auth.cap, auth.signingKey);
}

/**
 * Owner: add a channel to a public space — append it to the plaintext `_rooms`
 * registry and seed its empty message doc. Only the owner's account cap can write
 * (`pubspace:owner`); a joiner's `pubspace:writer` is withheld on `_rooms`.
 */
export async function createPublicRoom(
  session: Session,
  spaceId: string,
  name: string,
  category = DEFAULT_CATEGORY,
  kind: RoomKind = 'channel',
): Promise<Room> {
  const client = session.accountClient;
  const { rooms, name: spaceName, image, categories, hash } = await readPublicRoomsDoc(client, session.userId, spaceId);
  const room: Room = {
    id: `${spaceId}-${roomSlug(name)}-${Date.now().toString(36)}`,
    spaceId,
    category,
    name,
    kind,
  };
  // Preserve the shared name/image + category list so adding a channel never drops
  // the space identity or the ordered categories.
  const nextCategories = categories.includes(category) ? categories : [...categories, category];
  const doc: PublicRoomsDoc = {
    v: 1,
    rooms: [...rooms, room],
    ...(spaceName ? { name: spaceName } : {}),
    ...(image ? { image } : {}),
    ...(nextCategories.length ? { categories: nextCategories } : {}),
  };
  await client.push(pubspaceRoomsPush(session.userId, spaceId), doc as unknown as Record<string, unknown>, hash);
  // A 'channel' is a merge-doc room → seed its empty doc so a reader's first pull
  // finds it. A 'stream' is an append-only log (the `pubstream` collection) → no
  // seeding: an empty log simply pulls as []. (Its first element is the first append.)
  if (kind !== 'stream') {
    await client.push(pubspaceRoomPush(session.userId, spaceId, room.id), emptyRoomDoc(), null);
  }
  return room;
}

/**
 * Owner: update a public space's SHARED identity (name / image) in its plaintext
 * `_rooms` registry, written with the account cap (`pubspace:owner`). Joiners read
 * but can't write `_rooms`, so this is owner-only. Preserves the rooms list; an
 * `undefined` field is left unchanged and a `null`/empty image clears it.
 */
export async function updatePublicSpaceMeta(
  session: Session,
  spaceId: string,
  meta: { name?: string | null; image?: string | null },
): Promise<void> {
  const client = session.accountClient;
  const { rooms, name: curName, image: curImage, categories, hash } = await readPublicRoomsDoc(client, session.userId, spaceId);
  const name = (meta.name === undefined ? curName : meta.name)?.trim() || undefined;
  const image = (meta.image === undefined ? curImage : meta.image) || undefined;
  const doc: PublicRoomsDoc = {
    v: 1,
    rooms,
    ...(name ? { name } : {}),
    ...(image ? { image } : {}),
    ...(categories.length ? { categories } : {}),
  };
  await client.push(pubspaceRoomsPush(session.userId, spaceId), doc as unknown as Record<string, unknown>, hash);
}

/**
 * Owner: read-modify-write a public space's `_rooms` registry through one funnel —
 * the public twin of {@link updateRoomsRegistry}. Preserves the shared name/image,
 * runs the mutator over `{ rooms, categories }` (or `null` for a no-op). Public docs
 * are last-writer-wins (only the owner's own devices race), so no ConflictError loop.
 */
export async function updatePublicRoomsRegistry(
  session: Session,
  spaceId: string,
  mutator: (cur: { rooms: Room[]; categories: string[] }) => { rooms: Room[]; categories: string[] } | null,
): Promise<void> {
  const client = session.accountClient;
  // Read-modify-write through a bounded conflict-retry loop — the public-registry
  // twin of `updateRoomsRegistry`. Every automation tick rewrites this whole doc to
  // bump `lastRunAt`/`lastFetchHash`, so ticks contend with each other and with user
  // edits; without re-reading on a 409 a concurrent write throws and the dedup cursor
  // never persists (→ a duplicate repost on the next device). The mutator runs on
  // FRESH state each attempt so it can't clobber a sibling's write.
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { rooms, name, image, categories, hash } = await readPublicRoomsDoc(client, session.userId, spaceId);
    const next = mutator({ rooms, categories });
    if (!next) return;
    const doc: PublicRoomsDoc = {
      v: 1,
      rooms: next.rooms,
      ...(name ? { name } : {}),
      ...(image ? { image } : {}),
      ...(next.categories.length ? { categories: next.categories } : {}),
    };
    try {
      await client.push(pubspaceRoomsPush(session.userId, spaceId), doc as unknown as Record<string, unknown>, hash);
      return;
    } catch (err) {
      if (err instanceof ConflictError && attempt < MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }
}
