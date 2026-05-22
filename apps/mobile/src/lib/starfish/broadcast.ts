/**
 * Plaintext, cap-only shares — read-only "broadcast" links and read/write
 * "collaborative" links.
 *
 * Unlike `inviteToSpace` (which adds an E2EE keyring recipient to a whole space), a
 * share lives OUTSIDE any space, in the plaintext `shared` collection: the owner
 * publishes JSON the server can read, and access is authorized purely by a member
 * cap the owner SIGNS — no keyring, no wrapped keys. The reader is unknown in
 * advance, so the cap is minted against a THROWAWAY ephemeral keypair and BOTH the
 * owner-signed cap and that ephemeral private key are packed into the share link's
 * URL fragment. The link itself is the credential.
 *
 * Trade-off: broadcast/collaborative content is NOT end-to-end encrypted — the
 * server can read it, and for a read/write link anyone with the link can post (all
 * posts carry the one ephemeral identity; revocation is whole-share only). Surface
 * the warning at every share-creation point.
 */
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { bootstrapRootIdentity } from '@drakkar.software/starfish-identities';
import { mintMemberCap } from '@drakkar.software/starfish-sharing';
import type { StarfishClient } from '@drakkar.software/starfish-client';

import { makeClient, readProfile, type DeviceKeys } from './client';
import type { Session } from './identity';
import { broadcastReaderScope, sharedFeedPull, sharedFeedPush } from './paths';

/** One plaintext message in a share's feed. The author display name is baked in at
 *  publish time — plaintext readers can't resolve pseudos from the profile store. */
export interface BroadcastMessage {
  id: string;
  author: string;
  text: string;
  ts: number;
}

/** The single plaintext doc backing one share. */
export interface BroadcastFeed {
  v: 1;
  name: string;
  /** Whether this share accepts link-bearer writes (a collaborative link). */
  write: boolean;
  messages: BroadcastMessage[];
}

/** Everything a viewer needs, decoded from a share link's URL fragment. */
export interface ShareToken {
  ownerId: string;
  shareId: string;
  /** The owner-signed member cap (CapCert). */
  cap: unknown;
  /** The throwaway ephemeral subject's Ed25519 private key (hex) — signs requests. */
  key: string;
  /** Mirror of the cap's write authority, so the viewer can show a composer. */
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

/** Pack a share token into a `/share#…` link. The credential rides in the fragment
 *  (`#…`), which browsers never send to the server, put in `Referer`, or log. */
export function encodeShareLink(origin: string, token: ShareToken): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/share#${toBase64Url(JSON.stringify(token))}`;
}

/** Decode the token from a `#…` fragment (with or without the leading `#`). */
export function decodeShareToken(fragment: string): ShareToken {
  const frag = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  const tok = JSON.parse(fromBase64Url(frag)) as Partial<ShareToken>;
  if (!tok || !tok.ownerId || !tok.shareId || !tok.cap || !tok.key) {
    throw new Error('This share link is malformed or incomplete.');
  }
  return { ownerId: tok.ownerId, shareId: tok.shareId, cap: tok.cap, key: tok.key, write: !!tok.write };
}

/** A client authenticated as the link's ephemeral subject (for reads + writes). */
export function clientForToken(token: ShareToken): StarfishClient {
  return makeClient(token.cap, token.key);
}

/** Read a share's feed doc. Returns the parsed feed (or null if absent) + its hash
 *  for an optimistic-concurrency follow-up write. */
export async function readFeed(
  client: StarfishClient,
  ownerId: string,
  shareId: string,
): Promise<{ feed: BroadcastFeed | null; hash: string | null }> {
  const res = await client.pull(sharedFeedPull(ownerId, shareId)).catch(() => null);
  const data = res?.data as Partial<BroadcastFeed> | undefined;
  if (!data || !Array.isArray(data.messages)) return { feed: null, hash: res?.hash ?? null };
  return {
    feed: { v: 1, name: typeof data.name === 'string' ? data.name : 'Shared', write: !!data.write, messages: data.messages },
    hash: res?.hash ?? null,
  };
}

/** Append one message to a share's feed, retrying once on a concurrent-write hash
 *  conflict (multiple link-bearers can post to a collaborative share). */
export async function appendMessage(
  client: StarfishClient,
  ownerId: string,
  shareId: string,
  message: BroadcastMessage,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { feed, hash } = await readFeed(client, ownerId, shareId);
    if (!feed) throw new Error('This share no longer exists.');
    const next: BroadcastFeed = { ...feed, messages: [...feed.messages, message] };
    try {
      await client.push(sharedFeedPush(ownerId, shareId), next as unknown as Record<string, unknown>, hash);
      return;
    } catch (err) {
      if (attempt === 1) throw err; // give up after one retry
    }
  }
}

/** Build a fresh `BroadcastMessage` (stable id + now timestamp). */
export function makeBroadcastMessage(author: string, text: string): BroadcastMessage {
  return { id: `bm-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`, author, text: text.trim(), ts: Date.now() };
}

/** Minimal stored-message shape needed to snapshot a room into a plaintext feed. */
export interface SnapshotRow {
  id: string;
  authorId: string;
  text?: string;
  ts: number;
  parentId?: string;
}

/**
 * Snapshot a room's top-level messages into plaintext `BroadcastMessage`s, baking
 * in each author's display name (resolved from the public profile; "You" is never
 * used — a public reader isn't the author). Attachments can't render in the
 * plaintext viewer, so an attachment-only message becomes a placeholder line.
 */
export async function snapshotMessages(rows: SnapshotRow[], session: Session): Promise<BroadcastMessage[]> {
  const top = rows.filter((m) => !m.parentId);
  const ids = [...new Set(top.map((m) => m.authorId))];
  const names = new Map<string, string>();
  await Promise.all(
    ids.map(async (id) => {
      if (id === session.userId) {
        names.set(id, session.name);
        return;
      }
      const { pseudo } = await readProfile(id);
      names.set(id, pseudo?.trim() || id.slice(0, 8));
    }),
  );
  return top.map((m) => ({
    id: m.id,
    author: names.get(m.authorId) ?? m.authorId.slice(0, 8),
    text: m.text?.trim() || '(attachment)',
    ts: m.ts,
  }));
}

/**
 * Owner: create a new share. Mints a throwaway ephemeral keypair as the cap
 * subject, signs a read-only (or read/write) member cap for it scoped to this one
 * share, seeds the feed doc with `messages`, and returns the share token + link.
 *
 * `origin` is the app's web origin for the link (e.g. `https://app.octochat…`); the
 * caller passes `window.location.origin` on web.
 */
export async function createBroadcast(
  session: Session,
  name: string,
  messages: BroadcastMessage[],
  opts: { write?: boolean; origin: string },
): Promise<{ token: ShareToken; link: string; shareId: string }> {
  const write = !!opts.write;
  // Throwaway subject: a brand-new identity from a fresh random seed. Its userId is
  // 128-bit and serves double duty as the (unguessable) shareId. It differs from the
  // owner, so `assertMemberCapShape`'s `member-self` check passes.
  const eph = await bootstrapRootIdentity(generateMnemonic(wordlist, 128));
  const ek = eph.device as DeviceKeys;
  const shareId = eph.userId;
  const cap = await mintMemberCap(
    session.keys.edPriv,
    session.keys.edPub,
    { edPubHex: ek.edPub, kemPubHex: ek.kemPub, userIdHex: eph.userId },
    'shared',
    broadcastReaderScope(session.userId, shareId, write),
  );
  const feed: BroadcastFeed = { v: 1, name: name.trim() || 'Shared channel', write, messages };
  // The owner seeds the doc with their account cap (write gated `share:owner`).
  await session.accountClient.push(
    sharedFeedPush(session.userId, shareId),
    feed as unknown as Record<string, unknown>,
    null,
  );
  const token: ShareToken = { ownerId: session.userId, shareId, cap, key: ek.edPriv, write };
  return { token, link: encodeShareLink(opts.origin, token), shareId };
}
