/**
 * Space + room registries.
 *
 * Most functions are thin re-exports from @drakkar.software/starfish-spaces:
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
} from '@drakkar.software/starfish-spaces';
import { randomId } from '@drakkar.software/starfish-protocol';
import type { StarfishClient } from '@drakkar.software/starfish-client';

import type { ArchivedDms, DeclinedRequests, DmMap, MutePrefs, OutgoingRequest, OutgoingRequests, ReadPrefs, Room, Space } from '../domain/types';
import type { Session } from './identity';
import { ownerTrustedAdders } from './identity';
import { DEFAULT_CATEGORY } from './objects';
import { seedSpaceObjectIndex } from './object-index';
import { keyringPull, keyringPush } from './paths';

export type { SpaceMeta, SpaceMetaUpdate } from '@drakkar.software/starfish-spaces';

// updateMutesDoc / updateReadsDoc were removed from octospaces-sdk 0.23+.
// They are NOT re-exported here; callers should use updateSpacesExtraField directly.
export {
  // Spaces list + caps RMW
  updateSpacesDoc,
  updateSpacesExtraField,
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
} from '@drakkar.software/starfish-spaces';

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
const coerceDeclinedRequests = (v: unknown): DeclinedRequests => {
  const out: DeclinedRequests = {};
  for (const [k, val] of Object.entries(asRecord(v))) if (val === true) out[k] = true;
  return out;
};
const coerceOutgoingRequests = (v: unknown): OutgoingRequests => {
  const out: OutgoingRequests = {};
  for (const [k, val] of Object.entries(asRecord(v))) {
    const r = val as Partial<OutgoingRequest>;
    if (
      typeof r?.spaceId === 'string' &&
      (r.nodeType === 'room' || r.nodeType === 'ticket') &&
      typeof r.title === 'string' &&
      typeof r.ts === 'number' &&
      (r.status === 'pending' || r.status === 'refused')
    ) {
      out[k] = { spaceId: r.spaceId, nodeType: r.nodeType, title: r.title, ts: r.ts, status: r.status };
    }
  }
  return out;
};
const coerceMutes = (v: unknown): MutePrefs => {
  const r = asRecord(v);
  const nodes: MutePrefs['nodes'] = {};
  for (const [k, val] of Object.entries(asRecord(r.nodes))) if (val !== undefined) nodes[k] = val as MutePrefs['nodes'][string];
  const spaces: MutePrefs['spaces'] = {};
  for (const [k, val] of Object.entries(asRecord(r.spaces))) if (val !== undefined) spaces[k] = val as MutePrefs['spaces'][string];
  return { nodes, spaces };
};
const coerceReads = (v: unknown): ReadPrefs => {
  const r = asRecord(v);
  const nodes: ReadPrefs['nodes'] = {};
  for (const [k, val] of Object.entries(asRecord(r.nodes))) if (typeof val === 'number') nodes[k] = val;
  return { nodes };
};

/** {@link readSpacesCore} with the OctoChat-owned `extra` fields re-flattened onto the
 *  result (back-compat with pre-0.16 call sites that read `.dms`/`.archivedDms`/`.quickReactions`). */
export async function readSpaces(client: StarfishClient, session: Session) {
  const doc = await readSpacesCore(client, session);
  const extra = doc.extra ?? {};
  return {
    ...doc,
    dms: coerceDms(extra.dms),
    archivedDms: coerceArchivedDms(extra.archivedDms),
    quickReactions: coerceQuickReactions(extra.quickReactions),
    declinedRequests: coerceDeclinedRequests(extra.declinedRequests),
    outgoingRequests: coerceOutgoingRequests(extra.outgoingRequests),
    mutes: coerceMutes(extra.mutes),
    reads: coerceReads(extra.reads),
  };
}

export function updateDmsDoc(client: StarfishClient, session: Session, mutator: (cur: DmMap) => DmMap | null): Promise<void> {
  return updateSpacesExtraField<DmMap>(client, session, 'dms', (cur) => mutator(coerceDms(cur)));
}

export function updateArchivedDmsDoc(client: StarfishClient, session: Session, mutator: (cur: ArchivedDms) => ArchivedDms | null): Promise<void> {
  return updateSpacesExtraField<ArchivedDms>(client, session, 'archivedDms', (cur) => mutator(coerceArchivedDms(cur)));
}

export function updateQuickReactionsDoc(client: StarfishClient, session: Session, mutator: (cur: string[]) => string[] | null): Promise<void> {
  return updateSpacesExtraField<string[]>(client, session, 'quickReactions', (cur) => mutator(coerceQuickReactions(cur)));
}

export function updateDeclinedRequestsDoc(client: StarfishClient, session: Session, mutator: (cur: DeclinedRequests) => DeclinedRequests | null): Promise<void> {
  return updateSpacesExtraField<DeclinedRequests>(client, session, 'declinedRequests', (cur) => mutator(coerceDeclinedRequests(cur)));
}

/** Mark a resource-request id as declined by the owner — idempotent (no write when already present).
 *  Persisted in the `_spaces` doc under `extra.declinedRequests` so subsequent calls to
 *  `listPendingTicketRequests` filter it out, even after refresh or on other devices. */
export function setRequestDeclined(client: StarfishClient, session: Session, reqId: string): Promise<void> {
  return updateDeclinedRequestsDoc(client, session, (cur) => (cur[reqId] ? null : { ...cur, [reqId]: true }));
}

export function updateOutgoingRequestsDoc(client: StarfishClient, session: Session, mutator: (cur: OutgoingRequests) => OutgoingRequests | null): Promise<void> {
  return updateSpacesExtraField<OutgoingRequests>(client, session, 'outgoingRequests', (cur) => mutator(coerceOutgoingRequests(cur)));
}

/** Record a newly-filed resource request (status: 'pending') in the requester's `_spaces` doc.
 *  Idempotent — skips the write if an entry for the same reqId already exists. */
export function recordOutgoingRequest(
  client: StarfishClient,
  session: Session,
  reqId: string,
  info: Omit<OutgoingRequest, 'status'>,
): Promise<void> {
  return updateOutgoingRequestsDoc(client, session, (cur) =>
    cur[reqId] ? null : { ...cur, [reqId]: { ...info, status: 'pending' } },
  );
}

/** Mark an outgoing request as refused by the owner — idempotent (no write when already refused).
 *  Persisted in the `_spaces` doc under `extra.outgoingRequests` so the declined state survives
 *  refresh and app restart, and propagates to other devices. */
export function setOutgoingRequestRefused(client: StarfishClient, session: Session, reqId: string): Promise<void> {
  return updateOutgoingRequestsDoc(client, session, (cur) => {
    const entry = cur[reqId];
    if (!entry || entry.status === 'refused') return null;
    return { ...cur, [reqId]: { ...entry, status: 'refused' } };
  });
}

export function setDmMapping(client: StarfishClient, session: Session, peerUserId: string, spaceId: string): Promise<void> {
  return updateDmsDoc(client, session, (cur) => (cur[peerUserId] === spaceId ? null : { ...cur, [peerUserId]: spaceId }));
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
  const { spaces } = await readSpaces(spacesRegistryClient, session);
  const trimmed = name.trim() || 'New Space';
  const id = `sp-${randomId()}`;
  const space: Space = { id, name: trimmed, members: 1 };
  await writeSpaceAccess(accountClient, id, userId, [], null, session, { name: trimmed });
  await ownerEnsureKeyring(session.contentClient, session.keys, keyringPull(id), keyringPush(id), ownerTrustedAdders(session));
  await seedSpaceObjectIndex(session, id, [{ id: `${id}-general`, name: 'general', kind: 'channel', category: DEFAULT_CATEGORY, enc: true }]);
  await writeSpaces(spacesRegistryClient, session, [...spaces, space]);
  return space;
}
