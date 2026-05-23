import { describe, expect, it, vi } from 'vitest';

// links.ts value-imports `expo-router` (router) and `react-native` (Platform,
// Linking) for its navigation helpers; its `@/lib/types` import is type-only and
// erased at runtime. Stub the two native modules so the pure parser runs under Node.
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' }, Linking: { openURL: vi.fn() } }));

import { router } from 'expo-router';

import { linkify, matchesUser, mentionsUser, openRoom, type TextSegment } from './links';
import type { Room } from './types';

// Compact a segment to a tag for readable, order-sensitive assertions.
const tag = (s: TextSegment): string =>
  s.url ? `URL[${s.text}]` : s.room ? `#[${s.room}]` : s.user ? `@[${s.user}]` : JSON.stringify(s.text);
const tags = (input: string): string => linkify(input).map(tag).join(' ');

describe('linkify', () => {
  it('marks an @user mention', () => {
    expect(tags('hey @michel')).toBe('"hey " @[michel]');
  });

  it('splits a trailing period off an @mention (end of sentence)', () => {
    expect(tags('thanks @michel.')).toBe('"thanks " @[michel] "."');
  });

  it('handles a #channel and an @user in one line', () => {
    expect(tags('@michel see #design')).toBe('@[michel] " see " #[design]');
  });

  it('splits a trailing period off a #channel mention', () => {
    expect(tags('go #design.')).toBe('"go " #[design] "."');
  });

  it('keeps an internal dot in a handle', () => {
    expect(linkify('@michel.com here')[0]).toMatchObject({ user: 'michel.com' });
  });

  it('does not treat an email address as a mention', () => {
    expect(linkify('paul@drakkar.software').every((s) => !s.user && !s.room)).toBe(true);
  });

  it('does not mistake a URL #fragment for a channel', () => {
    const segs = linkify('see https://x.com/a#b');
    expect(segs.some((s) => s.room)).toBe(false);
    expect(segs.find((s) => s.url)?.url).toBe('https://x.com/a#b');
  });

  it('strips trailing punctuation back out of a URL', () => {
    const segs = linkify('docs at https://x.com/a.');
    expect(segs.find((s) => s.url)?.url).toBe('https://x.com/a');
    expect(segs.at(-1)).toEqual({ text: '.' });
  });

  it('does not treat "C#" as a channel', () => {
    expect(tags('I love C#')).toBe('"I love C#"');
  });

  it('returns one plain segment when nothing matches', () => {
    expect(linkify('plain text')).toEqual([{ text: 'plain text' }]);
  });
});

describe('matchesUser', () => {
  it('matches exactly, case-insensitively', () => {
    expect(matchesUser('Michel', 'michel')).toBe(true);
  });

  it('matches the first word of a spaced pseudo', () => {
    expect(matchesUser('michel', 'Michel Dupont')).toBe(true);
  });

  it('matches a spaced pseudo with the spaces removed', () => {
    expect(matchesUser('micheldupont', 'Michel Dupont')).toBe(true);
  });

  it('is false for a different name', () => {
    expect(matchesUser('bob', 'michel')).toBe(false);
  });

  it('is false when no viewer name is known', () => {
    expect(matchesUser('michel', undefined)).toBe(false);
  });
});

describe('mentionsUser', () => {
  it('detects a bare @mention', () => {
    expect(mentionsUser('hey @michel', 'michel')).toBe(true);
  });

  it('detects an @mention followed by a period (the headline case)', () => {
    expect(mentionsUser('thanks @michel.', 'michel')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(mentionsUser('@Michel hi', 'michel')).toBe(true);
  });

  it('matches a single-token mention of a spaced pseudo', () => {
    expect(mentionsUser('@michel hi', 'Michel Dupont')).toBe(true);
  });

  it('ignores an email address', () => {
    expect(mentionsUser('mail paul@drakkar.software', 'drakkar')).toBe(false);
  });

  it('is false when the viewer is not named', () => {
    expect(mentionsUser('hey @bob', 'michel')).toBe(false);
  });

  it('is false with no text or no name', () => {
    expect(mentionsUser(undefined, 'michel')).toBe(false);
    expect(mentionsUser('hey @michel', undefined)).toBe(false);
  });
});

describe('openRoom', () => {
  it('navigates to the room route carrying id/name/kind', () => {
    const room: Room = { id: 'r1', spaceId: 's1', category: 'DESIGN', name: 'design', kind: 'channel' };
    openRoom(room);
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/room/[id]',
      params: { id: 'r1', name: 'design', kind: 'channel' },
    });
  });
});
