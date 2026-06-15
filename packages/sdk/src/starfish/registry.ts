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
  readSpaces,
  writeSpaceAccess,
  writeSpaces,
  ownerEnsureKeyring,
  randomId,
} from '@drakkar.software/octospaces-sdk';

import type { Room, Space } from '../domain/types';
import type { Session } from './identity';
import { ownerTrustedAdders } from './identity';
import { DEFAULT_CATEGORY } from './objects';
import { seedSpaceObjectIndex } from './object-index';
import { keyringPull, keyringPush } from './paths';

export type { SpaceMeta, SpaceMetaUpdate } from '@drakkar.software/octospaces-sdk';

export {
  // Spaces list + caps RMW
  readSpaces,
  updateSpacesDoc,
  updateMutesDoc,
  updateReadsDoc,
  updateDmsDoc,
  updateQuickReactionsDoc,
  updateArchivedDmsDoc,
  setDmMapping,
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
  await ownerEnsureKeyring(session.chatClient, session.keys, keyringPull(id), keyringPush(id), ownerTrustedAdders(session));
  await seedSpaceObjectIndex(session, id, [{ id: `${id}-general`, name: 'general', kind: 'channel', category: DEFAULT_CATEGORY, enc: true }]);
  await writeSpaces(spacesRegistryClient, userId, [...spaces, space], hash);
  return space;
}
