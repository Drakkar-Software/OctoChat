/**
 * Issuer-binding for PUBLIC spaces — plaintext, cap-only spaces joined via a
 * space-wide invitation link (`pubspaces/{ownerId}/{spaceId}/{docId}`, where
 * `{docId}` is `_rooms` (the room registry) or a room id).
 *
 * Like the space registry, the collection is keyed by a free `{ownerId}` path
 * param, so a plain `cap:read:pubspace` role would let ANY validly-signed cap read
 * ANY owner's public space (`synthesizeRoles` is issuer-agnostic, and the
 * `{identity}` binding pins the cap's SUBJECT, not its issuer). We gate on
 * synthesized roles instead, decided purely from the requester's cap:
 *
 *   - `pubspace:owner`  — the owner managing their own public space. The owner uses
 *                         their account cap (a DEVICE cap), for which
 *                         `auth.identity = issUserId = ownerId`. Gates WRITES.
 *   - `pubspace:reader` — a link-bearer holding a MEMBER cap the owner minted. For a
 *                         member cap `synthesizeRoles` emits
 *                         `delegated:<issUserId>:pubspace`, which encodes the ISSUER;
 *                         we grant read only when that issuer is the path's owner.
 *                         Gates READS.
 *   - `pubspace:writer` — a read/write link-bearer (the member cap also carries write,
 *                         so `cap:write:pubspace` ∈ roles). Gates WRITES on room docs.
 *
 * Two subtleties this enricher handles (both were latent bugs in the simpler form):
 *
 *  - DEVICE caps never get a `delegated:` role (`synthesizeRoles` emits it for
 *    `kind: "member"` only). So the owner is granted `pubspace:reader` ALONGSIDE
 *    `pubspace:owner` — otherwise the owner could write but not READ their own data
 *    (e.g. their own room list). Mirrors space-role.ts emitting owner+member together.
 *
 *  - A read/write link must NOT let a guest rewrite the `_rooms` registry (add/delete
 *    rooms). `pubspace:writer` is withheld when `{docId} === "_rooms"`, so guests can
 *    post in rooms but only the owner manages the room list.
 */
import type { RoleEnricher } from "@drakkar.software/starfish-server";

export const PUBSPACE_OWNER_ROLE = "pubspace:owner";
export const PUBSPACE_READER_ROLE = "pubspace:reader";
export const PUBSPACE_WRITER_ROLE = "pubspace:writer";

/** A RoleEnricher granting the `pubspace:owner` / `:reader` / `:writer` roles. */
export function makePubspaceRoleEnricher(): RoleEnricher {
  return async (auth, params) => {
    const { ownerId, docId } = params;
    if (!ownerId || !auth.identity) return [];
    const roles: string[] = [];
    // Owner's account/device cap (auth.identity = issUserId = ownerId): full access.
    // Grant reader too — a device cap has no `delegated:` role, so without this the
    // owner couldn't read their own public space.
    if (auth.identity === ownerId) roles.push(PUBSPACE_OWNER_ROLE, PUBSPACE_READER_ROLE);
    // Link-bearer: a member OR audience cap the owner SIGNED → read. The
    // `delegated:<iss>:<col>` role (emitted for BOTH member and audience caps — see
    // cap-resolver `synthesizeRoles`) is the only request-time signal tying the grant
    // back to the issuer. We admit both the `pubspace` collection (a public-space
    // join link) and the `pubstream` collection (a stream-room bot link minted via
    // `createPublicLink`). The cap's own `scope.paths` still confines it (a bot link
    // pinned to `…/streams/**` gets these roles but can only reach the stream subtree).
    const delegatedByOwner =
      auth.roles.includes(`delegated:${ownerId}:pubspace`) ||
      auth.roles.includes(`delegated:${ownerId}:pubstream`);
    if (delegatedByOwner) {
      roles.push(PUBSPACE_READER_ROLE);
      // …and write room/stream docs (NOT the `_rooms` registry) if the cap carries
      // write. A stream append carries `{roomId}` (not `{docId}`), so the `_rooms`
      // owner-only guard is a no-op for it — only the pubspace `_rooms` doc is withheld.
      const canWrite =
        auth.roles.includes("cap:write:pubspace") || auth.roles.includes("cap:write:pubstream");
      if (docId !== "_rooms" && canWrite) {
        roles.push(PUBSPACE_WRITER_ROLE);
      }
    }
    return roles;
  };
}
