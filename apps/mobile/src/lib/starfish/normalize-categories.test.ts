import { describe, expect, it } from 'vitest';

import type { Room } from '@/lib/types';

import { normalizeCategories } from './registry';

const room = (id: string, category: string): Room => ({ id, spaceId: 'sp', category, name: id, kind: 'channel' });

describe('normalizeCategories', () => {
  it('derives the list from distinct room categories in document order when none is stored', () => {
    const rooms = [room('a', 'DESIGN'), room('b', 'CHANNELS'), room('c', 'DESIGN')];
    expect(normalizeCategories(rooms, undefined)).toEqual(['DESIGN', 'CHANNELS']);
  });

  it('treats a stored list as authoritative, preserving order AND empty categories', () => {
    const rooms = [room('a', 'CHANNELS'), room('b', 'DESIGN')];
    // 'INBOX' has no rooms but must survive (it's an explicitly-created category).
    expect(normalizeCategories(rooms, ['INBOX', 'DESIGN', 'CHANNELS'])).toEqual(['INBOX', 'DESIGN', 'CHANNELS']);
  });

  it('appends a room category missing from the stored list (never orphans a room)', () => {
    const rooms = [room('a', 'CHANNELS'), room('b', 'STRAY')];
    expect(normalizeCategories(rooms, ['CHANNELS'])).toEqual(['CHANNELS', 'STRAY']);
  });

  it('reads back an empty space as no categories', () => {
    expect(normalizeCategories([], undefined)).toEqual([]);
  });

  it('ignores a garbage stored value and falls back to the rooms', () => {
    const rooms = [room('a', 'CHANNELS')];
    expect(normalizeCategories(rooms, 'not-an-array')).toEqual(['CHANNELS']);
    expect(normalizeCategories(rooms, { junk: true })).toEqual(['CHANNELS']);
  });
});
