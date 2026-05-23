import { describe, expect, it, vi } from 'vitest';

// `message-view` → `links` value-imports `expo-router` + `react-native` for its
// navigation helpers (unused here). Stub them so the pure helpers run under Node,
// mirroring threads.test.ts.
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' }, Linking: { openURL: vi.fn() } }));

import { dayLabel, sameDay } from './message-view';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();

describe('sameDay', () => {
  const now = at(2026, 4, 23);

  it('is true within one calendar day regardless of time', () => {
    expect(sameDay(at(2026, 4, 23, 0), at(2026, 4, 23, 23))).toBe(true);
  });

  it('is false across a midnight boundary even when hours are close', () => {
    expect(sameDay(at(2026, 4, 22, 23), at(2026, 4, 23, 1))).toBe(false);
  });

  it('distinguishes the same day-of-month in different months/years', () => {
    expect(sameDay(at(2026, 3, 23), now)).toBe(false);
    expect(sameDay(at(2025, 4, 23), now)).toBe(false);
  });
});

describe('dayLabel', () => {
  const now = at(2026, 4, 23);

  it('labels the current day "Today"', () => {
    expect(dayLabel(at(2026, 4, 23, 9), now)).toBe('Today');
  });

  it('labels the prior day "Yesterday"', () => {
    expect(dayLabel(at(2026, 4, 22), now)).toBe('Yesterday');
  });

  it('omits the year for an older date in the current year', () => {
    const label = dayLabel(at(2026, 0, 5), now);
    expect(label).not.toBe('Today');
    expect(label).not.toBe('Yesterday');
    expect(label).not.toContain('2026');
  });

  it('includes the year once the date predates the current year', () => {
    expect(dayLabel(at(2025, 11, 30), now)).toContain('2025');
  });
});
