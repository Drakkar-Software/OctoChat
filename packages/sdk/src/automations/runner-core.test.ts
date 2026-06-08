import { describe, expect, it } from 'vitest';

import { isDueForScheduledTick } from './runner-core';
import type { AutomationMeta, Room } from '@drakkar.software/octochat-sdk';

const META: AutomationMeta = {
  providerId: 'rss',
  params: {},
  intervalMin: 15,
  enabled: true,
  // Sealed in production; `isDueForScheduledTick` never reads it, so a placeholder is fine.
  credential: {} as AutomationMeta['credential'],
  runOnDeviceId: 'device-A',
  lastRunAt: null,
  lastError: null,
};

const room = (over: Partial<AutomationMeta> = {}): Room => ({
  id: 'r1',
  spaceId: 'psp-1',
  category: 'AUTOMATIONS',
  name: 'a',
  kind: 'automated',
  automation: { ...META, ...over },
});

describe('isDueForScheduledTick', () => {
  it('is due when never run before', () => {
    expect(isDueForScheduledTick(room(), 'device-A', 1_000_000)).toBe(true);
  });

  it('skips when disabled', () => {
    expect(isDueForScheduledTick(room({ enabled: false }), 'device-A', 1_000_000)).toBe(false);
  });

  it('skips when intervalMin is 0 (commands-only)', () => {
    expect(isDueForScheduledTick(room({ intervalMin: 0 }), 'device-A', 1_000_000)).toBe(false);
  });

  it('skips on a non-elected device', () => {
    expect(isDueForScheduledTick(room(), 'device-B', 1_000_000)).toBe(false);
  });

  it('skips when too soon since last run', () => {
    const now = 1_000_000;
    expect(isDueForScheduledTick(room({ lastRunAt: now - 60_000 }), 'device-A', now)).toBe(false); // 1 min ago
  });

  it('fires when interval elapsed', () => {
    const now = 1_000_000;
    expect(isDueForScheduledTick(room({ lastRunAt: now - 16 * 60_000 }), 'device-A', now)).toBe(true); // 16 min ago
  });

  it('onOpen is due even when last run was a moment ago', () => {
    const now = 1_000_000;
    expect(isDueForScheduledTick(room({ onOpen: true, lastRunAt: now - 1_000 }), 'device-A', now)).toBe(true);
  });

  it('onOpen still respects enabled + elected device', () => {
    expect(isDueForScheduledTick(room({ onOpen: true, enabled: false }), 'device-A', 0)).toBe(false);
    expect(isDueForScheduledTick(room({ onOpen: true }), 'device-B', 0)).toBe(false);
  });

  it('returns false when room has no automation', () => {
    const r: Room = { id: 'r1', spaceId: 'psp-1', category: 'x', name: 'n', kind: 'channel' };
    expect(isDueForScheduledTick(r, 'device-A', 0)).toBe(false);
  });

  // Calendar cadences (UTC). epoch 0 = 1970-01-01 00:00 UTC (a Thursday, getUTCDay = 4).
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const daily: AutomationMeta['schedule'] = { kind: 'daily', hour: 9, minute: 0 };

  it('daily: not due before 09:00 UTC, due at/after it', () => {
    const last = 8 * HOUR; // 08:00 UTC, same day
    expect(isDueForScheduledTick(room({ schedule: daily, intervalMin: 0, lastRunAt: last }), 'device-A', 9 * HOUR - 1)).toBe(false);
    expect(isDueForScheduledTick(room({ schedule: daily, intervalMin: 0, lastRunAt: last }), 'device-A', 9 * HOUR)).toBe(true);
  });

  it('schedule overrides intervalMin (interval would fire, daily gate holds)', () => {
    const last = 8 * HOUR;
    const now = last + 16 * 60_000; // 08:16 — a 15-min interval would be due here
    expect(isDueForScheduledTick(room({ schedule: daily, intervalMin: 15, lastRunAt: last }), 'device-A', now)).toBe(false);
  });

  it('weekly: fires once a week on the chosen UTC weekday', () => {
    const weekly: AutomationMeta['schedule'] = { kind: 'weekly', weekday: 4, hour: 0, minute: 0 }; // Thursday 00:00
    const last = 0; // Thursday 00:00 UTC
    expect(isDueForScheduledTick(room({ schedule: weekly, intervalMin: 0, lastRunAt: last }), 'device-A', 7 * DAY - 1)).toBe(false);
    expect(isDueForScheduledTick(room({ schedule: weekly, intervalMin: 0, lastRunAt: last }), 'device-A', 7 * DAY)).toBe(true);
  });

  it('cron "0 9 *" fires at 09:00 UTC', () => {
    const cron: AutomationMeta['schedule'] = { kind: 'cron', expression: '0 9 *' };
    const last = 8 * HOUR;
    expect(isDueForScheduledTick(room({ schedule: cron, intervalMin: 0, lastRunAt: last }), 'device-A', 9 * HOUR - 1)).toBe(false);
    expect(isDueForScheduledTick(room({ schedule: cron, intervalMin: 0, lastRunAt: last }), 'device-A', 9 * HOUR)).toBe(true);
  });

  it('first run (lastRunAt null) is due immediately for a calendar schedule', () => {
    expect(isDueForScheduledTick(room({ schedule: daily, intervalMin: 0, lastRunAt: null }), 'device-A', 0)).toBe(true);
  });
});
