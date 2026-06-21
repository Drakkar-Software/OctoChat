/**
 * Space + room registries.
 *
 * Most functions are thin re-exports from @drakkar.software/octospaces-sdk:
 * the SpacesDoc RMW logic, space access record helpers, and all joined-space
 * bookkeeping live there and are identical in behavior.
 *
 * OctoChat-specific surface kept here:
 * - createSpace: seeds a `general` channel + mints the space keyring (not in SDK).
 * - normalizeCategories: uses OctoChat's Room type.
 * - CategoryError: user-facing category validation error.
 * - DEFAULT_CATEGORY re-export: backward-compat for existing consumers.
 */
import {
  readSpaces as readSpacesCore,
  updateSpacesExtraField,
  writeSpaceAccess,
  writeSpaces,
  ownerEnsureKeyring,
  randomId,
} from '@drakkar.software/octospaces-sdk';
import type { StarfishClient } from '@drakkar.software/starfish-client';

import type { ArchivedDms, DmMap, Room, Space } from '../domain/types';
import type { Session } from './identity';
import { ownerTrustedAdders } from './identity';
import { DEFAULT_CATEGORY } from './objects';
import { seedSpaceObjectIndex } from './object-index';
import { keyringPull, keyringPush } from './paths';

export type { SpaceMeta, SpaceMetaUpdate } from '@drakkar.software/octospaces-sdk';

export {
  // Spaces list + caps RMW
  updateSpacesDoc,
  updateMutesDoc,
  updateReadsDoc,
  writeSpaces,
  reorderSpaces,
  // Space access record
  readSpaceAccess,
  writeSpaceAccess,
  addSpaceMember,
  removeJoinedSpace,
  moveSpace,
  addJoinedSpace,
  addJoinedSpaceWithCap,
  // Space meta sync
  reconcileSpaceMeta,
  onSpaceMeta,
  broadcastSpaceMeta,
} from '@drakkar.software/octospaces-sdk';

// ── DM + quick-reactions registry surface (OctoChat-owned since octospaces 0.16) ──
// octospaces 0.16 extracted the DM/quick-reactions doc helpers out of the generic SDK,
// keeping only the generic `updateSpacesExtraField` + a `readSpaces(...).extra` passthrough.
// These thin wrappers reimplement OctoChat's prior API on top of that, storing the data
// under `_spaces` doc `extra.{dms,archivedDms,quickReactions}`. `readSpaces` below re-flattens
// those fields back onto the result so every existing call site stays unchanged.

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});
const coerceDms = (v: unknown): DmMap => {
  const out: DmMap = {};
  for (const [k, val] of Object.entries(asRecord(v))) if (typeof val === 'string') out[k] = val;
  return out;
};
const coerceArchivedDms = (v: unknown): ArchivedDms => {
  const out: ArchivedDms = {};
  for (const [k, val] of Object.entries(asRecord(v))) if (val === true) out[k] = true;
  return out;
};
const coerceQuickReactions = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** {@link readSpacesCore} with the OctoChat-owned `extra` fields re-flattened onto the
 *  result (back-compat with pre-0.16 call sites that read `.dms`/`.archivedDms`/`.quickReactions`). */
export async function readSpaces(client: StarfishClient, userId: string) {
  const doc = await readSpacesCore(client, userId);
  const extra = doc.extra ?? {};
  return {
    ...doc,
    dms: coerceDms(extra.dms),
    archivedDms: coerceArchivedDms(extra.archivedDms),
    quickReactions: coerceQuickReactions(extra.quickReactions),
  };
}

export function updateDmsDoc(client: StarfishClient, userId: string, mutator: (cur: DmMap) => DmMap | null): Promise<void> {
  return updateSpacesExtraField<DmMap>(client, userId, 'dms', (cur) => mutator(coerceDms(cur)));
}

export function updateArchivedDmsDoc(client: StarfishClient, userId: string, mutator: (cur: ArchivedDms) => ArchivedDms | null): Promise<void> {
  return updateSpacesExtraField<ArchivedDms>(client, userId, 'archivedDms', (cur) => mutator(coerceArchivedDms(cur)));
}

export function updateQuickReactionsDoc(client: StarfishClient, userId: string, mutator: (cur: string[]) => string[] | null): Promise<void> {
  return updateSpacesExtraField<string[]>(client, userId, 'quickReactions', (cur) => mutator(coerceQuickReactions(cur)));
}

export function setDmMapping(client: StarfishClient, userId: string, peerUserId: string, spaceId: string): Promise<void> {
  return updateDmsDoc(client, userId, (cur) => (cur[peerUserId] === spaceId ? null : { ...cur, [peerUserId]: spaceId }));
}

// Re-export so existing `import { DEFAULT_CATEGORY } from './registry'` consumers keep working.
export { DEFAULT_CATEGORY };

/** A user-facing category validation failure (empty/duplicate name). The hook layer
 *  surfaces `message` verbatim, unlike an opaque network/HTTP error. */
export class CategoryError extends Error {}

/** The ordered category list for a space. The stored `categories` array (when
 *  present) is authoritative; absent it, derive it from the distinct `room.category`
 *  values in document order so a pre-feature registry reads back identically. Any
 *  room category missing from a stored list is appended (defensive — never orphans a
 *  room into an unrendered bucket). */
export function normalizeCategories(rooms: Room[], stored: unknown): string[] {
  const distinct: string[] = [];
  for (const r of rooms) if (r.category && !distinct.includes(r.category)) distinct.push(r.category);
  const list = Array.isArray(stored) ? stored.filter((c): c is string => typeof c === 'string') : [];
  if (!list.length) return distinct;
  const result = [...list];
  for (const c of distinct) if (!result.includes(c)) result.push(c);
  return result;
}

/**
 * Create a new space (+ a seeded "general" channel) owned by the identity.
 *
 * OctoChat-specific: stamps the space:owner claim first (TOFU), then mints the
 * space-wide keyring (required before any enc room can be opened or messages sent),
 * then seeds an encrypted object index with a `general` channel. The generic SDK
 * createSpace does not seed rooms or mint the keyring.
 *
 * Order matters for crash-safety: claim ownership first so `space:owner` is
 * satisfied, then mint keyring, then seed index, then add to the user's list.
 */
export async function createSpace(session: Session, name: string): Promise<Space> {
  const { accountClient, spacesRegistryClient, userId } = session;
  const { spaces, hash } = await readSpaces(spacesRegistryClient, userId);
  const trimmed = name.trim() || 'New Space';
  const id = `sp-${randomId()}`;
  const space: Space = { id, name: trimmed, short: trimmed.slice(0, 2).toUpperCase(), members: 1 };
  await writeSpaceAccess(accountClient, id, userId, [], null, { name: trimmed });
  await ownerEnsureKeyring(session.contentClient, session.keys, keyringPull(id), keyringPush(id), ownerTrustedAdders(session));
  await seedSpaceObjectIndex(session, id, [{ id: `${id}-general`, name: 'general', kind: 'channel', category: DEFAULT_CATEGORY, enc: true }]);
  await writeSpaces(spacesRegistryClient, userId, [...spaces, space], hash);
  return space;
}
