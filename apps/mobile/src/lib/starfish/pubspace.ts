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
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { bootstrapRootIdentity } from '@drakkar.software/starfish-identities';
import { mintMemberCap } from '@drakkar.software/starfish-sharing';
import type { StarfishClient } from '@drakkar.software/starfish-client';

import type { Room, Space } from '@/lib/types';

import { makeClient, type DeviceKeys } from './client';
import type { Session } from './identity';
import { pubspaceRoomPush, pubspaceRoomsPull, pubspaceRoomsPush, pubspaceScope } from './paths';
import { getPubspaceAccess, savePubspaceAccess } from './pubspace-caps';
import { addJoinedSpace } from './registry';

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

/** Opaque public-space id; ownership is recorded by the `{ownerId}` storage path. */
function newPublicSpaceId(): string {
  return `psp-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

const monogram = (name: string) => name.trim().slice(0, 2).toUpperCase() || 'PS';

interface PublicRoomsDoc {
  v: 1;
  rooms: Room[];
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

/** Read a public space's room registry doc + its hash (for an append write). */
async function readPublicRoomsDoc(
  client: StarfishClient,
  ownerId: string,
  spaceId: string,
): Promise<{ rooms: Room[]; hash: string | null }> {
  const res = await client.pull(pubspaceRoomsPull(ownerId, spaceId)).catch(() => null);
  const rooms = (res?.data as Partial<PublicRoomsDoc> | undefined)?.rooms;
  return { rooms: Array.isArray(rooms) ? rooms : [], hash: res?.hash ?? null };
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
  const doc: PublicRoomsDoc = { v: 1, rooms: [general] };
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
  const eph = await bootstrapRootIdentity(generateMnemonic(wordlist, 128));
  const ek = eph.device as DeviceKeys;
  const cap = await mintMemberCap(
    session.keys.edPriv,
    session.keys.edPub,
    { edPubHex: ek.edPub, kemPubHex: ek.kemPub, userIdHex: eph.userId },
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
  savePubspaceAccess(token.spaceId, { ownerId: token.ownerId, cap: token.cap, key: token.key, write: token.write });
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
  await addJoinedSpace(session.accountClient, session.userId, space);
  return space;
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
  category = 'CHANNELS',
): Promise<Room> {
  const client = session.accountClient;
  const { rooms, hash } = await readPublicRoomsDoc(client, session.userId, spaceId);
  const room: Room = {
    id: `${spaceId}-${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now().toString(36)}`,
    spaceId,
    category,
    name,
    kind: 'channel',
  };
  const doc: PublicRoomsDoc = { v: 1, rooms: [...rooms, room] };
  await client.push(pubspaceRoomsPush(session.userId, spaceId), doc as unknown as Record<string, unknown>, hash);
  await client.push(pubspaceRoomPush(session.userId, spaceId, room.id), emptyRoomDoc(), null);
  return room;
}
