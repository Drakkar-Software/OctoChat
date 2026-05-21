/**
 * Owner-binding for the integrity-sensitive plaintext docs (room keyring +
 * member roster).
 *
 * Those collections are authorized purely by cap SCOPE — the resolver never
 * asks "is the caller the room owner". On its own that lets any writer member
 * (who holds `cap:write:chat`) overwrite a room's keyring or wipe its member
 * directory. We close that by gating their write role behind `chat:owner`, a
 * role this enricher grants ONLY to the room's owner.
 *
 * Ownership is trust-on-first-use: the owner is whoever created the room's
 * keyring (its epoch-1 genesis adder). A device cap's effective identity is its
 * issuer (the root), so every one of the owner's devices qualifies; a member
 * cap resolves to the stranger's id and is refused. While the keyring does not
 * exist yet the room is being created, so the first writer is allowed (and
 * becomes the owner once it lands).
 *
 * Mirrors the canonical example (`examples/app/backend/server.py` @ 51513cd).
 */
import { createHash } from "node:crypto";
import type { ObjectStore, RoleEnricher } from "@drakkar.software/starfish-server";

export const OWNER_ROLE = "chat:owner";

/** Derive the room owner's userId from the keyring's genesis adder (epoch 1). */
function ownerUserIdFromKeyring(raw: string): string | null {
  try {
    const doc = JSON.parse(raw) as Record<string, unknown>;
    const data = (doc && typeof doc === "object" && "data" in doc ? doc.data : doc) as
      | { epochs?: Record<string, { wrappedKeys?: { addedBy?: unknown }[] }> }
      | undefined;
    const addedBy = data?.epochs?.["1"]?.wrappedKeys?.[0]?.addedBy;
    if (typeof addedBy !== "string") return null;
    return createHash("sha256").update(Buffer.from(addedBy, "hex")).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

/** A RoleEnricher that grants {@link OWNER_ROLE} to a room's owner. */
export function makeOwnerRoleEnricher(store: ObjectStore): RoleEnricher {
  return async (auth, params) => {
    const roomId = params.roomId;
    if (!roomId) return [];
    let raw: string | null = null;
    try {
      raw = await store.getString(`chatkeyring/rooms/${roomId}/_keyring`);
    } catch {
      raw = null; // store error ⇒ treat as "no keyring"
    }
    // TOFU: room not created yet ⇒ the first writer is allowed and becomes owner.
    if (!raw) return [OWNER_ROLE];
    const owner = ownerUserIdFromKeyring(raw);
    // Unparseable keyring ⇒ keep TOFU open so a stranger who wins the create race
    // with a garbage keyring can't permanently brick the room (recoverable DoS):
    // the legitimate owner's valid keyring write wins once it lands.
    if (owner === null) return [OWNER_ROLE];
    return owner === auth.identity ? [OWNER_ROLE] : [];
  };
}
