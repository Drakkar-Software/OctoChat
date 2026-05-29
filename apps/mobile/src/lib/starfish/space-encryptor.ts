/**
 * One private-space {@link Encryptor} (+ its sync client), cached per SPACE and
 * shared across the room screen and any thread of it — the router Stack keeps
 * `room/[id]` mounted under `thread/[id]`, so both `useRoom` the same space and would
 * otherwise each pull the space `_keyring`. Keyed by spaceId because one keyring
 * drives every channel in a space.
 *
 * This replaces the old global `dedupe('keyring:…')` request hack with an explicit,
 * owned cache (mirroring the public-profile cache in `use-pseudos`). It is cleared on
 * account switch via {@link clearSpaceEncryptors}, wired into
 * `session-context.resetAccountScopedState`. Pure crypto/data — no React — so it can
 * be cleared from session-context without an import cycle through the room hooks.
 */
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import { makeClient, openEncryptor, ownerEnsureKeyring } from './client';
import type { Session } from './identity';
import { ownerTrustedAdders } from './identity';
import { getMemberCap } from './member-caps';

export interface SpaceEncryptor {
  encryptor: Encryptor;
  client: StarfishClient;
  /** True when opened as the space OWNER (so the caller must seed the room doc). */
  isOwnerOpen: boolean;
}

const cache = new Map<string, Promise<SpaceEncryptor>>();

/** Drop every cached space encryptor (on account switch — keys are per-identity). */
export function clearSpaceEncryptors(): void {
  cache.clear();
}

/**
 * Resolve a private space's encryptor + sync client, opening (and caching) it on
 * first use. Two auth modes, mirroring the room-open branches:
 *  - JOINED (a stored member cap): open as a keyring recipient; the cap's issuer is
 *    the trusted keyring adder.
 *  - OWN / unhydrated (no cap): only the genuine OWNER may create/own the keyring, so
 *    decide from the registry `owner` (in `reg`, read once via the shared rooms
 *    registry). `owner === null` ⇒ legacy/unreadable: treat as owner, as before. A
 *    member whose cap hasn't hydrated MUST NOT fall into the owner branch — that would
 *    fail the keyring's trustedAdders check and could re-create the keyring, locking
 *    everyone out — so it throws a "reconnect / re-invite" error instead.
 *
 * `reg` is only consulted in the no-cap branch; pass null when a member cap is held.
 * A failed open is dropped from the cache so a retry can re-open.
 */
export function getSpaceEncryptor(
  spaceId: string,
  session: Session,
  reg: { owner: string | null; members: string[] } | null,
): Promise<SpaceEncryptor> {
  const hit = cache.get(spaceId);
  if (hit) return hit;
  const p = (async (): Promise<SpaceEncryptor> => {
    const memberCap = getMemberCap(spaceId);
    if (memberCap) {
      const cap = JSON.parse(memberCap) as { iss?: string };
      const client = makeClient(cap, session.keys.edPriv);
      const encryptor = await openEncryptor(client, session.keys, spaceId, cap.iss ? [cap.iss] : []);
      return { encryptor, client, isOwnerOpen: false };
    }
    const owner = reg?.owner ?? null;
    const members = reg?.members ?? [];
    if (owner !== null && owner !== session.userId) {
      throw new Error(
        members.includes(session.userId)
          ? "You're a member of this space, but its key isn't on this device yet — reconnect, or ask the owner to re-invite."
          : "You don't have access to this space.",
      );
    }
    // Owned keyring entries are signed by the root key (== device key for a
    // seed/Nostr session; the cap-cert issuer for a paired device).
    const encryptor = await ownerEnsureKeyring(
      session.chatClient,
      session.keys,
      spaceId,
      ownerTrustedAdders(session),
    );
    return { encryptor, client: session.chatClient, isOwnerOpen: true };
  })();
  cache.set(spaceId, p);
  p.catch(() => cache.delete(spaceId)); // a failed open must not stick
  return p;
}
