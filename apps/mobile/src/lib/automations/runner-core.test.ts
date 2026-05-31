import { describe, expect, it } from 'vitest';

import { isDueForScheduledTick } from './runner-core';
import type { AutomationMeta, Room } from '../types';

const META: AutomationMeta = {
  providerId: 'rss',
  params: {},
  intervalMin: 15,
  enabled: true,
  credential: { token: 't', endpoint: 'e', signPath: '/push/x' },
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
});
