/**
 * Object type registry — the single place that maps an {@link ObjectType} (builtin OR
 * user-defined) to how the app treats it: which content sync model it uses, which icon
 * renders it, and a human label. Keeping this open-ended is what lets a future custom
 * type drop in without a renderer rewrite — unknown types resolve to a generic
 * descriptor (a merge-doc with a neutral glyph) instead of being special-cased away.
 *
 * Pure data/logic (no React) so any layer — hooks picking a collection, the tree
 * picking a glyph — reads the same descriptors.
 *
 * NOTE: `octospaces-sdk` ships no domain types — OctoChat owns these strings.
 * {@link ROOM_TYPES} is the canonical set of OctoChat object-type string constants.
 */
import type { ObjectContentKind, ObjectNode, ObjectType, RoomSubtype } from './types';

/** OctoChat's own object-type string constants (octospaces-sdk ships no domain types). */
export const ROOM_TYPES = {
  room: 'room',
  category: 'category',
  dm: 'dm',
  automation: 'automation',
} as const;

export type RoomObjectType = (typeof ROOM_TYPES)[keyof typeof ROOM_TYPES];

/** An icon key — the UI maps it to a glyph. A plain string here keeps the SDK
 *  free of the app's `IconName` union; the app casts where it renders an `<Icon>`. */
export type IconKey = string;

export interface ObjectDescriptor {
  /** Default content sync model for this type (a node's own `contentKind` overrides). */
  contentKind: ObjectContentKind;
  icon: IconKey;
  label: string;
}

const BUILTINS: Record<string, ObjectDescriptor> = {
  room: { contentKind: 'merge', icon: 'hash', label: 'Channel' },
  category: { contentKind: 'none', icon: 'folder', label: 'Category' },
  automation: { contentKind: 'append', icon: 'pulse', label: 'Automation' },
  doc: { contentKind: 'merge', icon: 'file', label: 'Doc' },
  project: { contentKind: 'append', icon: 'work', label: 'Project' },
  task: { contentKind: 'none', icon: 'check', label: 'Task' },
};

/** The fallback for an unknown (custom) type: a structureless-until-declared object
 *  that renders generically. Its content model comes from the NODE's `contentKind`
 *  (see {@link contentKindOf}); the descriptor's is only the last-resort default. */
const GENERIC: ObjectDescriptor = { contentKind: 'merge', icon: 'layers', label: 'Object' };

/** Resolve a type's descriptor — a builtin, or the generic fallback for a custom type. */
export function objectDescriptor(type: ObjectType): ObjectDescriptor {
  return BUILTINS[type] ?? GENERIC;
}

/** Room subtypes refine the room glyph; everything else uses its type descriptor. */
export function iconForNode(node: Pick<ObjectNode, 'type' | 'subtype'>): IconKey {
  if (node.type === 'room') return roomSubtypeIcon(node.subtype);
  return objectDescriptor(node.type).icon;
}

function roomSubtypeIcon(subtype: RoomSubtype | undefined): IconKey {
  switch (subtype) {
    case 'dm':
      return 'dm';
    case 'automation':
      return 'pulse';
    // `default` covers `channel` AND a legacy persisted `stream` subtype (rooms predate
    // the stream↔channel merge): both render with the plain `#` channel glyph.
    default:
      return 'hash';
  }
}

/** The effective content sync model for a node: its explicit `contentKind` wins (a
 *  custom type declares its own), else the type descriptor's default. This is the one
 *  function the hook layer needs to pick `useDoc` (merge) vs `useProject` (append). */
export function contentKindOf(node: Pick<ObjectNode, 'type' | 'contentKind'>): ObjectContentKind {
  return node.contentKind ?? objectDescriptor(node.type).contentKind;
}
