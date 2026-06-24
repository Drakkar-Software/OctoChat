import { describe, expect, it } from 'vitest';

import {
  ancestors,
  addObject,
  breadcrumbs,
  channelNodeAccess,
  objectsToRoomCategories,
  seedIndexNodes,
  type SeedRoom,
} from './objects';
import type { ObjectNode } from '../domain/types';

/**
 * The create-time seed contract: what `createSpace`/`createDmSpace` write into the object
 * index ({@link seedIndexNodes}) must project back through {@link objectsToRoomCategories}
 * to exactly the room list the chat UI renders. With the legacy `_rooms` room-list +
 * on-device migration removed, this round-trip is the ONLY thing that puts a freshly
 * created space's `general` channel (or a DM's single room) on screen — so it's the unit
 * stand-in for the "create a space → does general appear?" smoke test.
 */
describe('seedIndexNodes → objectsToRoomCategories round-trip', () => {
  it('seeds a new space general channel into one CHANNELS bucket', () => {
    const seed: SeedRoom[] = [{ id: 'sp-1-general', name: 'general', kind: 'channel', category: 'CHANNELS', enc: true }];
    const nodes = seedIndexNodes(seed, 1);

    expect(objectsToRoomCategories(nodes, 'sp-1', 'CHANNELS')).toEqual([
      { name: 'CHANNELS', rooms: [{ id: 'sp-1-general', spaceId: 'sp-1', category: 'CHANNELS', name: 'general', kind: 'channel', enc: true }] },
    ]);
  });

  it('seeds a DM room (kind:dm round-trips via subtype) under its category', () => {
    const seed: SeedRoom[] = [{ id: 'dm-1-room', name: 'Ada', kind: 'dm', category: 'CHANNELS' }];
    const nodes = seedIndexNodes(seed, 1);

    // DM rooms without enc default to enc:true (space-member access)
    expect(objectsToRoomCategories(nodes, 'dm-1', 'CHANNELS')).toEqual([
      { name: 'CHANNELS', rooms: [{ id: 'dm-1-room', spaceId: 'dm-1', category: 'CHANNELS', name: 'Ada', kind: 'dm', enc: true }] },
    ]);
  });

  it('groups multiple seed rooms by category, preserving insertion order', () => {
    const seed: SeedRoom[] = [
      { id: 'r1', name: 'general', kind: 'channel', category: 'CHANNELS' },
      { id: 'r2', name: 'design', kind: 'channel', category: 'DESIGN' },
      { id: 'r3', name: 'random', kind: 'channel', category: 'CHANNELS' },
    ];
    const cats = objectsToRoomCategories(seedIndexNodes(seed, 1), 'sp-1', 'CHANNELS');

    expect(cats?.map((c) => [c.name, c.rooms.map((r) => r.id)])).toEqual([
      ['CHANNELS', ['r1', 'r3']],
      ['DESIGN', ['r2']],
    ]);
  });

  it('returns null for an empty seed (no room/category nodes — caller renders nothing)', () => {
    expect(objectsToRoomCategories(seedIndexNodes([], 1), 'sp-1', 'CHANNELS')).toBeNull();
  });
});

describe('ancestors (breadcrumb trail = root→parent, EXCLUSIVE of self)', () => {
  const node = (id: string, parentId: string | null, title = id): ObjectNode => ({
    id,
    type: 'doc',
    parentId,
    order: 0,
    title,
    updatedAt: 1,
  });
  // root → child → grandchild
  const nodes = [node('root', null), node('child', 'root'), node('grand', 'child')];

  it('drops the node itself, returning only its root→parent path', () => {
    expect(ancestors(nodes, 'grand').map((n) => n.id)).toEqual(['root', 'child']);
  });

  it('is empty for a root-level node (no ancestors → breadcrumb renders nothing)', () => {
    expect(ancestors(nodes, 'root')).toEqual([]);
  });

  it('is the strict prefix of breadcrumbs (which still includes self last)', () => {
    expect(breadcrumbs(nodes, 'grand').map((n) => n.id)).toEqual(['root', 'child', 'grand']);
    expect(ancestors(nodes, 'grand')).toEqual(breadcrumbs(nodes, 'grand').slice(0, -1));
  });

  it('is empty for an unknown node', () => {
    expect(ancestors(nodes, 'nope')).toEqual([]);
  });
});

describe('objectsToRoomCategories per-node access/enc passthrough', () => {
  const catNode = (id: string, title: string): ObjectNode => ({
    id, type: 'category', parentId: null, order: 0, title, updatedAt: 1,
  });
  const roomNode = (id: string, parentId: string, extra: Partial<ObjectNode> = {}): ObjectNode => ({
    id, type: 'room', subtype: 'channel', parentId, order: 0, title: id, updatedAt: 1, ...extra,
  });

  it('passes through access:public to the projected Room', () => {
    const nodes = [catNode('c1', 'CH'), roomNode('r1', 'c1', { access: 'public', enc: false })];
    const cats = objectsToRoomCategories(nodes, 'sp-1', 'CH');
    const room = cats?.[0]?.rooms[0];
    expect(room?.access).toBe('public');
    expect(room?.enc).toBe(false);
  });

  it('passes through access:invite to the projected Room', () => {
    const nodes = [catNode('c1', 'CH'), roomNode('r1', 'c1', { access: 'invite', enc: true })];
    const room = objectsToRoomCategories(nodes, 'sp-1', 'CH')?.[0]?.rooms[0];
    expect(room?.access).toBe('invite');
    expect(room?.enc).toBe(true);
  });

  // THE KEY REGRESSION TEST: absent enc defaults to true for space-member rooms.
  // This is what caused the attachment bug: enc was undefined → useRoom computed
  // enc:false → no encryptor → uploadAttachment returned null.
  it('defaults enc:true when access/enc both absent (space-member E2EE default)', () => {
    const nodes = [catNode('c1', 'CH'), roomNode('r1', 'c1')];
    const room = objectsToRoomCategories(nodes, 'sp-1', 'CH')?.[0]?.rooms[0];
    expect(room?.access).toBeUndefined();
    expect(room?.enc).toBe(true);
  });

  it('defaults enc:true for explicit access:space rooms', () => {
    const nodes = [catNode('c1', 'CH'), roomNode('r1', 'c1', { access: 'space' })];
    const room = objectsToRoomCategories(nodes, 'sp-1', 'CH')?.[0]?.rooms[0];
    expect(room?.enc).toBe(true);
  });

  it('defaults enc:false for access:public when enc not stored', () => {
    const nodes = [catNode('c1', 'CH'), roomNode('r1', 'c1', { access: 'public' })];
    const room = objectsToRoomCategories(nodes, 'sp-1', 'CH')?.[0]?.rooms[0];
    expect(room?.enc).toBe(false);
  });

  it('defaults enc:false for access:invite when enc not stored', () => {
    const nodes = [catNode('c1', 'CH'), roomNode('r1', 'c1', { access: 'invite' })];
    const room = objectsToRoomCategories(nodes, 'sp-1', 'CH')?.[0]?.rooms[0];
    expect(room?.enc).toBe(false);
  });

  it('stored enc:false always overrides the default (e.g. private room explicitly not encrypted)', () => {
    const nodes = [catNode('c1', 'CH'), roomNode('r1', 'c1', { enc: false })];
    const room = objectsToRoomCategories(nodes, 'sp-1', 'CH')?.[0]?.rooms[0];
    expect(room?.enc).toBe(false);
  });

  it('stored enc:true always overrides the default (e.g. invite room explicitly encrypted)', () => {
    const nodes = [catNode('c1', 'CH'), roomNode('r1', 'c1', { access: 'public', enc: true })];
    const room = objectsToRoomCategories(nodes, 'sp-1', 'CH')?.[0]?.rooms[0];
    expect(room?.enc).toBe(true);
  });

  it('addObject creates a node without access/enc (set separately via channelNodeAccess)', () => {
    const { node } = addObject([], { type: 'room', title: 'room', id: 'sp-x-r' }, 1);
    expect(node.access).toBeUndefined();
    expect(node.enc).toBeUndefined();
  });

  it('addObject threads access:public + enc:false onto the node when provided', () => {
    const { node } = addObject([], { type: 'room', title: 'pub', id: 'sp-y-r', access: 'public', enc: false }, 1);
    expect(node.access).toBe('public');
    expect(node.enc).toBe(false);
  });

  it('addObject threads enc:true onto the node when provided', () => {
    const { node } = addObject([], { type: 'room', title: 'priv', id: 'sp-z-r', enc: true }, 1);
    expect(node.access).toBeUndefined();
    expect(node.enc).toBe(true);
  });

  it('seedIndexNodes threads enc:true from SeedRoom onto the node', () => {
    const seed: SeedRoom[] = [{ id: 'sp-1-general', name: 'general', kind: 'channel', category: 'CHANNELS', enc: true }];
    const nodes = seedIndexNodes(seed, 1);
    const roomNode = nodes.find((n) => n.type === 'room');
    expect(roomNode?.enc).toBe(true);
  });

  it('seedIndexNodes threads access:public + enc:false from SeedRoom onto the node', () => {
    const seed: SeedRoom[] = [{ id: 'sp-1-pub', name: 'public', kind: 'channel', category: 'CHANNELS', access: 'public', enc: false }];
    const nodes = seedIndexNodes(seed, 1);
    const roomNode = nodes.find((n) => n.type === 'room');
    expect(roomNode?.access).toBe('public');
    expect(roomNode?.enc).toBe(false);
  });
});

describe('channelNodeAccess helper', () => {
  it('private channel (isPublic=false) → enc:true, no access', () => {
    const result = channelNodeAccess(false);
    expect(result).toEqual({ enc: true });
    expect(result.access).toBeUndefined();
  });

  it('public channel (isPublic=true) → access:public, enc:false', () => {
    const result = channelNodeAccess(true);
    expect(result).toEqual({ access: 'public', enc: false });
  });

  it('private channel round-trips through toRoom as enc:true', () => {
    const catNode: ObjectNode = { id: 'cat', type: 'category', parentId: null, order: 0, title: 'CH', updatedAt: 1 };
    const { node } = addObject([], { type: 'room', title: 'private', id: 'r-priv', parentId: 'cat', ...channelNodeAccess(false) }, 1);
    const nodes = [catNode, node];
    const room = objectsToRoomCategories(nodes, 'sp', 'CH')?.[0]?.rooms[0];
    expect(room?.enc).toBe(true);
    expect(room?.access).toBeUndefined();
  });

  it('public channel round-trips through toRoom as access:public, enc:false', () => {
    const catNode: ObjectNode = { id: 'cat', type: 'category', parentId: null, order: 0, title: 'CH', updatedAt: 1 };
    const { node } = addObject([], { type: 'room', title: 'public', id: 'r-pub', parentId: 'cat', ...channelNodeAccess(true) }, 1);
    const nodes = [catNode, node];
    const room = objectsToRoomCategories(nodes, 'sp', 'CH')?.[0]?.rooms[0];
    expect(room?.enc).toBe(false);
    expect(room?.access).toBe('public');
  });
});

