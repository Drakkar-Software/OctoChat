/**
 * Issuer-binding for plaintext, cap-only shares
 * (`shared/{ownerId}/{shareId}/{docId}`) — read-only "broadcast" links and
 * read/write "collaborative" links, both link-bearer.
 *
 * The collection is keyed by a free `{ownerId}` path param, so — like the space
 * registry — a plain `cap:read:shared` role would let ANY validly-signed cap read
 * ANY owner's share (`synthesizeRoles` is issuer-agnostic, and the `{identity}`
 * binding pins the cap's SUBJECT, not its issuer). We gate on synthesized roles
 * instead, decided purely from the requester's cap — no store read needed:
 *
 *   - `share:owner`  — the owner managing their own share. An owner uses a DEVICE
 *                      cap, for which `auth.identity = issUserId = ownerId`, so we
 *                      grant it when `auth.identity === params.ownerId`. Gates WRITES.
 *   - `share:reader` — a public reader holding a MEMBER cap the owner minted. For a
 *                      member cap `synthesizeRoles` emits `delegated:<issUserId>:shared`,
 *                      which encodes the ISSUER; we grant read only when that issuer
 *                      is the path's owner (`delegated:{ownerId}:shared` ∈ auth.roles).
 *                      Gates READS.
 *   - `share:writer` — a member cap the owner minted with WRITE op (a read/write
 *                      invitation link). Same issuer binding as `share:reader`, plus
 *                      the cap must actually carry write authority
 *                      (`cap:write:shared` ∈ auth.roles, emitted by `synthesizeRoles`
 *                      from `scope.ops`). Gates WRITES alongside `share:owner`.
 *
 * Reads/writes thus require a cap the owner SIGNED (the owner is the CA), and the
 * member cap's own `scope.paths` (`shared/{ownerId}/{shareId}/**`) confines each
 * holder to one share — defense-in-depth against cross-share access within an owner.
 *
 * NOTE on read/write links: the cap (and its subject key) live in the URL, so the
 * link IS the credential — anyone with it can write, all writes carry the one
 * ephemeral subject identity, and revocation is whole-share only (CRL on the cap
 * nonce). For attributable, individually-revocable collaborators, mint a per-person
 * member cap instead (the known-recipient "guest channel" variant).
 */
import type { RoleEnricher } from "@drakkar.software/starfish-server";

export const SHARE_OWNER_ROLE = "share:owner";
export const SHARE_READER_ROLE = "share:reader";
export const SHARE_WRITER_ROLE = "share:writer";

/** A RoleEnricher granting the `share:owner` / `share:reader` / `share:writer` roles. */
export function makeShareRoleEnricher(): RoleEnricher {
  return async (auth, params) => {
    const ownerId = params.ownerId;
    if (!ownerId || !auth.identity) return [];
    const roles: string[] = [];
    // Owner's own device cap (auth.identity = issUserId = ownerId) → may write.
    if (auth.identity === ownerId) roles.push(SHARE_OWNER_ROLE);
    // A member cap issued BY this owner → may read. The `delegated:<issUserId>:shared`
    // role is the only request-time signal that ties the grant back to the issuer.
    if (auth.roles.includes(`delegated:${ownerId}:shared`)) {
      roles.push(SHARE_READER_ROLE);
      // …and may write too, if that owner-issued cap also carries write authority.
      if (auth.roles.includes("cap:write:shared")) roles.push(SHARE_WRITER_ROLE);
    }
    return roles;
  };
}
