/**
 * Per-room automation mutators on the unified OBJECT INDEX. An automated room is a `room`
 * NODE with `subtype: 'automation'` carrying its `automation` meta — the shape
 * {@link objectsToRoomCategories} projects back to a `kind: 'automated'` Room. These helpers
 * go through the {@link updateObjectIndex} funnel (works for any space — the old public-only
 * restriction is lifted now that access is per-node, not per-space).
 */
import { updateObjectIndex } from '@drakkar.software/octospaces-sdk';
import { addObject, archiveObject, categoryId, patchObject, roomKindToSubtype } from '../starfish/objects';
import type { Session } from '../starfish/identity';
import type { AutomationMeta, ObjectNode } from '../domain/types';

// updateObjectIndex provides octospaces-sdk's ObjectNode[]; cast to OctoChat's superset
// which carries the `automation` field (still used for per-node automation config).
const asLocal = (nodes: import('@drakkar.software/octospaces-sdk').ObjectNode[]) => nodes as unknown as ObjectNode[];

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const findCategoryNode = (nodes: ObjectNode[], name: string) =>
  nodes.find((n) => n.type === 'category' && !n.archived && sameName(n.title, name));

/**
 * Create the automated room as an object-index NODE (subtype `automation`) under its
 * category bucket (created if missing), stamping the full automation meta in one write —
 * the node twin of the old `createPublicRoom` + `setRoomAutomation`. The room id is minted
 * by the caller (so it can return the Room before the write settles).
 */
export async function createAutomationNode(
  session: Session,
  spaceId: string,
  roomId: string,
  name: string,
  category: string,
  automation: AutomationMeta,
): Promise<void> {
  await updateObjectIndex(session, spaceId, (raw, now) => {
    let next = asLocal(raw);
    let catId = findCategoryNode(next, category)?.id;
    if (!catId) {
      const r = addObject(next, { type: 'category', id: categoryId(category), title: category }, now);
      next = r.nodes;
      catId = r.node.id;
    }
    return addObject(
      next,
      { type: 'room', id: roomId, subtype: roomKindToSubtype('automated'), parentId: catId, title: name, automation },
      now,
    ).nodes as unknown as import('@drakkar.software/octospaces-sdk').ObjectNode[];
  });
}

/**
 * Merge a patch into an automated room node's `automation` meta. No-op when the node is
 * gone or carries no automation, so a stray tick write-back can't resurrect a deleted room.
 */
export async function patchRoomAutomation(
  session: Session,
  spaceId: string,
  roomId: string,
  patch: Partial<AutomationMeta>,
): Promise<void> {
  await updateObjectIndex(session, spaceId, (raw, now) => {
    const nodes = asLocal(raw);
    const node = nodes.find((n) => n.id === roomId);
    if (!node?.automation) return null;
    return patchObject(nodes, roomId, { automation: { ...node.automation, ...patch } }, now) as unknown as import('@drakkar.software/octospaces-sdk').ObjectNode[];
  });
}

/** Rename an automated room node (its display title). No-op when gone, blank, or unchanged. */
export async function renameRoomInRegistry(
  session: Session,
  spaceId: string,
  roomId: string,
  name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await updateObjectIndex(session, spaceId, (raw, now) => {
    const nodes = asLocal(raw);
    const node = nodes.find((n) => n.id === roomId);
    if (!node || node.title === trimmed) return null;
    return patchObject(nodes, roomId, { title: trimmed }, now) as unknown as import('@drakkar.software/octospaces-sdk').ObjectNode[];
  });
}

/** Archive (soft-delete) an automated room node + its subtree. No-op when already gone. */
export async function deleteRoomFromRegistry(
  session: Session,
  spaceId: string,
  roomId: string,
): Promise<void> {
  await updateObjectIndex(session, spaceId, (raw, now) => {
    const nodes = asLocal(raw);
    if (!nodes.some((n) => n.id === roomId && !n.archived)) return null;
    return archiveObject(nodes, roomId, now) as unknown as import('@drakkar.software/octospaces-sdk').ObjectNode[];
  });
}
