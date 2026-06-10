/**
 * Shareable "DM me" links — start a 1:1 E2EE DM with NO space in common.
 *
 * A DM link is nothing but the owner's IDENTITY, made portable: their userId,
 * display pseudo and published public keys (Ed25519 + KEM), base64url-packed into
 * a `/dm#…` URL fragment. There is no credential, no state and no lifecycle —
 * every account has the same permanent link, derivable on any of its devices, and
 * anyone holding it (or, equivalently, the owner's userId) can deliver a DM
 * invite. That is by design: see docs/dm-links.md for the threat model.
 *
 * Opening a link reuses the normal DM machinery end-to-end (space + keyring +
 * member cap via `inviteToSpace` — identical crypto to a carrier-delivered DM)
 * and swaps only DELIVERY: the sealed invite is appended ANONYMOUSLY to the
 * owner's personal inbox (`dminbox/<ownerId>/<month>`, public-write/owner-read —
 * see apps/server config), signed with the sender's own key (the server verifies
 * the append author proof even for anonymous writes). The owner's reconciler
 * ({@link reconcileDmInbox}) trial-unseals + auto-accepts on its normal cadence.
 *
 * The same delivery path backs profile-initiated DMs with no shared space
 * ({@link createOrOpenDmViaInbox}, used by the app's `use-dm` hook): a peer's
 * keys are public, so the inbox is reachable for any peer, not only link openers.
 *
 * Key trust: the embedded keys make first contact independent of the server —
 * `ownerId` must equal sha256(edPub) (checked offline — see
 * {@link verifyDmLinkBinding}), and the keys are cross-checked against the owner's
 * public profile when it is reachable, so neither a lying server nor a tampered
 * link can silently redirect the encryption to another keypair. (Wholesale link
 * substitution — sending you someone else's link with a familiar pseudo — is out
 * of scope for ANY link design; verify the fingerprint out-of-band when it matters.)
 */
import { sealToRecipient } from './account-seal';
import { postSignedAppend } from '../automations/append';

import { fromBase64Url, toBase64Url } from './base64url';
import { createDmSpaceCore, dmSpaceRecord, type DmRef } from './dm';
import { dmRoomId } from './dm-ids';
import { readPeerKeys, type PeerKeys } from './dm-keys';
import type { Session } from './identity';
import { inviteToSpace } from './members';
import { dmInboxShard, dminboxPush, userIdFromEdPub } from './paths';
import { addJoinedSpace, readSpaces, setDmMapping } from './registry';

/** What a `/dm#…` fragment decodes to: the owner's portable identity. `pseudo` is
 *  only a display hint until the live profile loads; the KEYS are what the DM is
 *  sealed to, and `ownerId` is bound to `edPub` by derivation (verified). */
export interface DmLinkToken {
  v: 1;
  ownerId: string;
  pseudo: string;
  edPub: string;
  kemPub: string;
}

const OWNER_ID_RE = /^[0-9a-f]{32}$/;
const ED_PUB_RE = /^[0-9a-f]{64}$/;
const KEM_PUB_RE = /^[0-9a-f]{32,}$/; // KEM key length is suite-dependent; require hex

const MALFORMED = 'That DM link is malformed or incomplete.';

/** The hard, OFFLINE trust anchor: a token's `ownerId` must be the hash of its
 *  `edPub` (`userIdFromEdPub`). A consumer can call this before showing anything
 *  about the owner, so a tampered token never even renders a misleading identity.
 *  {@link createDmViaLink} re-checks it (defense in depth) plus the live-profile
 *  key cross-check. */
export async function verifyDmLinkBinding(token: DmLinkToken): Promise<boolean> {
  return (await userIdFromEdPub(token.edPub)) === token.ownerId;
}

/** Pack a DM-link token into a `<origin>/dm#…` URL. The identity rides in the
 *  fragment (`#…`), which browsers never send to the server, put in `Referer`,
 *  or log — the pubspace-invite precedent (nothing here is secret, but the
 *  fragment keeps link opens out of server/access logs). */
export function encodeDmLink(origin: string, token: DmLinkToken): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}/dm#${toBase64Url(JSON.stringify(token))}`;
}

/** Decode + shape-check a `#…` fragment (with or without the leading `#`).
 *  Synchronous shape validation only; the `ownerId` ↔ `edPub` derivation binding
 *  is verified in {@link createDmViaLink} (it needs async hashing). */
export function decodeDmLink(fragment: string): DmLinkToken {
  const frag = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  let tok: Partial<DmLinkToken>;
  try {
    tok = JSON.parse(fromBase64Url(frag)) as Partial<DmLinkToken>;
  } catch {
    throw new Error(MALFORMED);
  }
  if (
    !tok ||
    tok.v !== 1 ||
    typeof tok.ownerId !== 'string' ||
    !OWNER_ID_RE.test(tok.ownerId) ||
    typeof tok.edPub !== 'string' ||
    !ED_PUB_RE.test(tok.edPub) ||
    typeof tok.kemPub !== 'string' ||
    !KEM_PUB_RE.test(tok.kemPub)
  ) {
    throw new Error(MALFORMED);
  }
  return {
    v: 1,
    ownerId: tok.ownerId,
    pseudo: typeof tok.pseudo === 'string' ? tok.pseudo : '',
    edPub: tok.edPub,
    kemPub: tok.kemPub,
  };
}

/**
 * This account's own "DM me" link — derivable on ANY device, always the same:
 * it embeds the account's PUBLISHED identity keys (the root keys peers must seal
 * to). The root device reads them straight from the session; a paired device
 * resolves them through the (cached) public profile, like a peer would. Returns
 * `null` only when the keys aren't published yet (brand-new identity that never
 * synced).
 */
export async function myDmLink(session: Session, origin: string): Promise<string | null> {
  const keys: PeerKeys | null =
    session.ownerEdPub === session.keys.edPub
      ? { edPub: session.keys.edPub, kemPub: session.keys.kemPub }
      : await readPeerKeys(session.userId);
  if (!keys) return null;
  return encodeDmLink(origin, {
    v: 1,
    ownerId: session.userId,
    pseudo: session.name,
    edPub: keys.edPub,
    kemPub: keys.kemPub,
  });
}

/** The peer a DM is opened with: their stable userId + published identity keys
 *  (from a link token, or from `readPeerKeys` on the profile screen). */
export interface DmPeer {
  userId: string;
  edPub: string;
  kemPub: string;
}

/**
 * Start (or open) a DM with `peer` via the per-recipient inbox — works with NO
 * shared space, from any device, for ANY peer whose keys are known (a link opener
 * OR a profile-initiated DM; the caller is responsible for trusting `peer`'s
 * keys). Reuses the whole normal DM creation flow and swaps only delivery: the
 * sealed invite is appended anonymously to the owner's CURRENT month shard, the
 * author proof signed with this session's own key. The space is registered in the
 * sender's `_spaces` only AFTER delivery succeeds, so a failed delivery can't
 * leave a ghost DM. Idempotent: an existing mapping for this peer short-circuits.
 */
export async function createOrOpenDmViaInbox(session: Session, peer: DmPeer, ownerPseudo: string): Promise<DmRef> {
  if (peer.userId === session.userId) throw new Error('This is your own DM link.');
  // Dedup against fresh server state (covers a DM created on another device or via
  // a shared-space carrier) — the twin of createOrOpenDm's short-circuit.
  const { dms } = await readSpaces(session.accountClient, session.userId);
  const existing = dms[peer.userId];
  if (existing) return { spaceId: existing, roomId: dmRoomId(existing) };

  // Create the DM space + invite the owner through the EXISTING machinery (keyring
  // recipient + roster + member cap). The bundle is named after the VISITOR — that
  // is the peer pseudo from the owner's side of the DM.
  const ref = await createDmSpaceCore(session, ownerPseudo);
  const requestJson = JSON.stringify({ edPub: peer.edPub, kemPub: peer.kemPub, userId: peer.userId });
  const inviteJson = await inviteToSpace(session, ref.spaceId, requestJson, true, session.name);
  // Deliver: seal to the owner (same blob a carrier would hold) and append it to
  // their current-month inbox shard with an anonymous signed POST (the collection
  // is public-write; an authenticated request would fail its cap's path scope).
  const sealed = await sealToRecipient(session, peer.kemPub, inviteJson);
  await postSignedAppend({
    signPath: dminboxPush(peer.userId, dmInboxShard()),
    element: { sealed, ts: Date.now() },
    author: { edPubHex: session.keys.edPub, edPrivHex: session.keys.edPriv },
    failurePrefix: 'DM invite delivery',
  });
  // Delivery succeeded — only now surface the space on this account.
  await addJoinedSpace(session.accountClient, session.userId, dmSpaceRecord(ref.spaceId, ownerPseudo));
  await setDmMapping(session.accountClient, session.userId, peer.userId, ref.spaceId);
  return ref;
}

/**
 * Visitor: start (or open) the DM with a LINK's owner. Verifies the link's
 * identity binding first — `ownerId === sha256(edPub)` offline
 * ({@link verifyDmLinkBinding}), and the embedded keys must match the owner's
 * public profile whenever it is reachable (a lying server OR a tampered link
 * fails loudly instead of redirecting the encryption) — then hands off to
 * {@link createOrOpenDmViaInbox}.
 */
export async function createDmViaLink(session: Session, token: DmLinkToken, ownerPseudo: string): Promise<DmRef> {
  if (token.ownerId === session.userId) throw new Error('This is your own DM link.');
  if (!(await verifyDmLinkBinding(token))) throw new Error(MALFORMED);
  // Belt-and-suspenders: when the owner's profile is reachable, the embedded keys
  // must agree with it (the KEM key is not derivable from edPub, so this is what
  // catches a kemPub-swapped link). Unreachable profile ⇒ proceed on the embedded
  // keys — that server-independence is the point of embedding them.
  const profile = await readPeerKeys(token.ownerId).catch(() => null);
  if (profile && (profile.edPub !== token.edPub || profile.kemPub !== token.kemPub)) {
    throw new Error("This DM link doesn't match the owner's published identity keys.");
  }
  return createOrOpenDmViaInbox(
    session,
    { userId: token.ownerId, edPub: token.edPub, kemPub: token.kemPub },
    ownerPseudo,
  );
}
