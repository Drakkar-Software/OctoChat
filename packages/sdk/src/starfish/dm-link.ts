/**
 * Shareable identity links — one portable token, two uses (DM + ticket request).
 *
 * A link is nothing but the owner's IDENTITY made portable: their userId, display pseudo and
 * PUBLISHED public keys (Ed25519 + KEM) plus a `kemSig` (Ed25519 signature of `kemPub` by the
 * identity's `edPriv`), base64url-packed into a URL fragment. It is the **v:2 `IdentityLink`**
 * from `@drakkar.software/dk-spaces-sdk` — the SAME token the ticket-request flow
 * (`submitResourceRequest`) consumes — so DM and request share one format, one verifier, one
 * producer (`myIdentityLink`). There is no credential, no state and no lifecycle.
 *
 * Two delivery layers ride on the shared token:
 *  - **DM** ({@link createDmViaLink}) — reuses the normal DM machinery (space + keyring + member
 *    cap via `inviteToSpace`) and swaps only delivery: the sealed invite is appended ANONYMOUSLY
 *    to the owner's inbox; the owner's reconciler ({@link reconcileDmInbox}) auto-accepts.
 *  - **Ticket request** — a thin `?s=<spaceId>` wrapper ({@link encodeRequestLink} /
 *    {@link decodeRequestLink}) names a target space; `submitResourceRequest` seals the request
 *    to the same `kemPub`.
 *
 * Key trust ({@link resolveLinkOwner}, also enforced inside `submitResourceRequest`): the embedded
 * keys make first contact server-independent. `verifyIdentityLinkBinding` checks OFFLINE that
 * `ownerId === sha256(edPub)` AND that `kemSig` is a valid signature of `kemPub` by `edPub`;
 * `verifyIdentityLinkKeys` additionally cross-checks the keys against the owner's published profile
 * whenever it is reachable. So neither a lying server nor a tampered link can redirect the
 * encryption. (Wholesale link substitution is out of scope for ANY link design — verify the
 * fingerprint out-of-band when it matters.)
 */
import {
  decodeIdentityLink,
  verifyIdentityLinkBinding,
  verifyIdentityLinkKeys,
  type IdentityLink,
} from '@drakkar.software/starfish-spaces';
import { userIdFromEdPub } from '@drakkar.software/dk-spaces-sdk';

import { sealToRecipient } from './account-seal';
import { postSignedAppend } from '../automations/append';

import { createDmSpaceCore, dmSpaceRecord, type DmRef } from './dm';
import { dmRoomId } from './dm-ids';
import type { Session } from './identity';
import { inviteToSpace } from './members';
import { dmInboxShard, inboxPush } from './paths';
import { addJoinedSpace, readSpaces, setDmMapping } from './registry';

/** The peer a DM is opened with: their stable userId + published identity keys
 *  (from a link token, or from `readPeerKeys` on the profile screen). */
export interface DmPeer {
  userId: string;
  edPub: string;
  kemPub: string;
  /** Ed25519 signature of `kemPub` by the peer's `edPriv` — required by `parseJoinRequest`. */
  kemSig: string;
}

/**
 * Standalone offline binding check — works WITHOUT a session (anonymous / pre-login callers).
 * Verifies `ownerId === sha256(edPub)` AND `kemSig` is a valid Ed25519 signature of `kemPub`.
 * Does NOT cross-check against the live profile (see `resolveLinkOwner` for that).
 */
export async function verifyLinkBinding(token: IdentityLink): Promise<boolean> {
  try {
    // Shim: verifyIdentityLinkBinding only reads session.userIdFromEdPub.
    // userIdFromEdPub from dk-spaces-sdk is the standalone Web-Crypto implementation.
    return await verifyIdentityLinkBinding(token, { userIdFromEdPub } as unknown as Session);
  } catch {
    return false;
  }
}

export async function resolveLinkOwner(token: IdentityLink, session: Session): Promise<DmPeer> {
  if (!(await verifyIdentityLinkBinding(token, session))) {
    throw new Error('That identity link is malformed or its signature does not verify.');
  }
  await verifyIdentityLinkKeys(token, session); // throws if the live profile has different keys
  return { userId: token.ownerId, edPub: token.edPub, kemPub: token.kemPub, kemSig: token.kemSig };
}

/**
 * Start (or open) a DM with `peer` via the per-recipient inbox — works with NO shared space, from
 * any device, for ANY peer whose keys are known (a link opener OR a profile-initiated DM; the
 * caller is responsible for trusting `peer`'s keys). Reuses the whole normal DM creation flow and
 * swaps only delivery: the sealed invite is appended anonymously to the owner's CURRENT month
 * shard, the author proof signed with this session's own key. The space is registered in the
 * sender's `_spaces` only AFTER delivery succeeds, so a failed delivery can't leave a ghost DM.
 * Idempotent: an existing mapping for this peer short-circuits.
 */
export async function createOrOpenDmViaInbox(session: Session, peer: DmPeer, ownerPseudo: string): Promise<DmRef> {
  if (peer.userId === session.userId) throw new Error('This is your own link.');
  // Dedup against fresh server state (covers a DM created on another device or via a shared-space
  // carrier) — the twin of createOrOpenDm's short-circuit.
  const { dms } = await readSpaces(session.spacesRegistryClient, session);
  const existing = dms[peer.userId];
  if (existing) return { spaceId: existing, roomId: dmRoomId(existing) };

  // Create the DM space + invite the owner through the EXISTING machinery (keyring recipient +
  // roster + member cap). The bundle is named after the VISITOR — the peer pseudo from the owner's
  // side of the DM.
  const ref = await createDmSpaceCore(session, ownerPseudo, peer.userId);
  const requestJson = JSON.stringify({ edPub: peer.edPub, kemPub: peer.kemPub, userId: peer.userId, kemSig: peer.kemSig });
  const inviteJson = await inviteToSpace(session, ref.spaceId, requestJson, true, session.name);
  // Deliver: seal to the owner (same blob a carrier would hold) and append it to their
  // current-month inbox shard with an anonymous signed POST (the collection is public-write; an
  // authenticated request would fail its cap's path scope).
  const sealed = await sealToRecipient(session, peer.kemPub, inviteJson);
  await postSignedAppend({
    signPath: inboxPush(peer.userId, dmInboxShard()),
    element: { sealed, ts: Date.now() },
    author: { edPubHex: session.keys.edPub, edPrivHex: session.keys.edPriv },
    failurePrefix: 'DM invite delivery',
  });
  // Delivery succeeded — only now surface the space on this account.
  await addJoinedSpace(session.spacesRegistryClient, session, dmSpaceRecord(ref.spaceId, ownerPseudo));
  await setDmMapping(session.spacesRegistryClient, session, peer.userId, ref.spaceId);
  return ref;
}

/**
 * Visitor: start (or open) a DM with a LINK's owner. Verifies the link via {@link resolveLinkOwner}
 * (offline binding + kemSig, plus the live-profile cross-check) — a lying server OR a tampered link
 * fails loudly instead of redirecting the encryption — then hands off to {@link createOrOpenDmViaInbox}.
 */
export async function createDmViaLink(session: Session, token: IdentityLink, ownerPseudo: string): Promise<DmRef> {
  if (token.ownerId === session.userId) throw new Error('This is your own link.');
  const peer = await resolveLinkOwner(token, session);
  return createOrOpenDmViaInbox(session, peer, ownerPseudo);
}

// ── Request link: identity token + a target space, in one shareable URL ───────────────────────

/**
 * Pack a target space into an identity link, producing one shareable **request link**
 * (`…/request?s=<spaceId>#<identity-token>`) a non-member uses to file a ticket into that space.
 * The space rides in the query (the server never sees the fragment), the identity in the fragment
 * — so it decodes with the same {@link decodeIdentityLink} the DM flow uses.
 */
export function encodeRequestLink(identityLink: string, spaceId: string): string {
  const hash = identityLink.indexOf('#');
  const base = hash === -1 ? identityLink : identityLink.slice(0, hash);
  const fragment = hash === -1 ? '' : identityLink.slice(hash); // keep the leading '#'
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}s=${encodeURIComponent(spaceId)}${fragment}`;
}

/**
 * Decode a request link (or a bare identity link) → the owner's identity token + the target space
 * (`null` when absent, i.e. a plain identity link). Accepts a full URL or a bare `#…` fragment.
 */
export function decodeRequestLink(urlOrFragment: string): { identity: IdentityLink; spaceId: string | null } {
  const hash = urlOrFragment.indexOf('#');
  const beforeHash = hash === -1 ? '' : urlOrFragment.slice(0, hash);
  const fragment = (hash === -1 ? urlOrFragment : urlOrFragment.slice(hash + 1)).replace(/^#/, '');
  let spaceId: string | null = null;
  const q = beforeHash.indexOf('?');
  if (q !== -1) spaceId = new URLSearchParams(beforeHash.slice(q + 1)).get('s');
  return { identity: decodeIdentityLink(fragment), spaceId };
}
