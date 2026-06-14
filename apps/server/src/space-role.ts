/**
 * Membership-binding for a space's access record at `spaces/{spaceId}/_access`,
 * which holds: `{ owner, members: [...userIds], name, image }`.
 *
 * The collection is keyed by a free `{spaceId}` path param, so a plain cap role
 * would let any authenticated identity read — or overwrite — any space by id. We
 * gate it on two synthesized roles instead:
 *   - `space:owner`  — the creator (TOFU: first writer stamps `owner`). Gates
 *                      access-record WRITES and keyring WRITES.
 *   - `space:member` — the owner OR any userId listed in `members`. Gates READS
 *                      and is the role a space invite grants by adding the joinee
 *                      to `members`.
 *
 * Visibility and encryption are per-node (on ObjectNode), not per-space — a space
 * is a neutral container. The public/private distinction (`pubspace:*` enricher)
 * has been retired; use per-node `access:'public'` instead.
 *
 * Storage leaf renamed from `_rooms` → `_access` (octospaces-sdk@0.4.1+).
 */
import type { ObjectStore, RoleEnricher } from "@drakkar.software/starfish-server";

export const SPACE_OWNER_ROLE = "space:owner";
export const SPACE_MEMBER_ROLE = "space:member";

/** Owner + member roster recorded in a space's access record doc. */
function spaceAccessFromRegistry(raw: string): { owner: string | null; members: string[] } {
  try {
    const doc = JSON.parse(raw) as Record<string, unknown>;
    const data = (doc && typeof doc === "object" && "data" in doc ? doc.data : doc) as
      | { owner?: unknown; members?: unknown }
      | undefined;
    const owner = typeof data?.owner === "string" ? data.owner : null;
    const members = Array.isArray(data?.members)
      ? (data!.members as unknown[]).filter((m): m is string => typeof m === "string")
      : [];
    return { owner, members };
  } catch {
    return { owner: null, members: [] };
  }
}

/** A RoleEnricher granting {@link SPACE_OWNER_ROLE} / {@link SPACE_MEMBER_ROLE}
 *  from the access record at `spaces/{spaceId}/_access`. */
export function makeSpaceRoleEnricher(store: ObjectStore): RoleEnricher {
  return async (auth, params) => {
    const spaceId = params.spaceId;
    if (!spaceId || !auth.identity) return [];
    let raw: string | null = null;
    try {
      raw = await store.getString(`spaces/${spaceId}/_access`);
    } catch {
      raw = null; // store error ⇒ treat as "no registry yet"
    }
    // TOFU: space not created yet ⇒ the first writer is allowed and becomes owner.
    if (!raw) return [SPACE_OWNER_ROLE, SPACE_MEMBER_ROLE];
    const { owner, members } = spaceAccessFromRegistry(raw);
    // Unparseable / owner-less doc ⇒ keep TOFU open (recoverable DoS).
    if (owner === null) return [SPACE_OWNER_ROLE, SPACE_MEMBER_ROLE];
    if (owner === auth.identity) return [SPACE_OWNER_ROLE, SPACE_MEMBER_ROLE];
    if (members.includes(auth.identity)) return [SPACE_MEMBER_ROLE];
    return [];
  };
}
