import { describe, expect, it } from 'vitest';

import { effectiveSchedule, isValidCronExpression, nextScheduledRunAt } from './schedule';
import type { AutomationMeta } from '@drakkar.software/octochat-sdk';

const HOUR = 3_600_000;
const DAY = 86_400_000;

describe('nextScheduledRunAt', () => {
  it('interval is anchored to the from-instant (legacy min-gap)', () => {
    expect(nextScheduledRunAt({ kind: 'interval', everyMin: 15 }, 1_000)).toBe(1_000 + 15 * 60_000);
  });

  it('interval with non-positive everyMin never fires', () => {
    expect(nextScheduledRunAt({ kind: 'interval', everyMin: 0 }, 1_000)).toBeNull();
  });

  it('daily returns the next 09:00 UTC strictly after from', () => {
    // from = 1970-01-01 08:00 UTC → same-day 09:00.
    expect(nextScheduledRunAt({ kind: 'daily', hour: 9, minute: 0 }, 8 * HOUR)).toBe(9 * HOUR);
    // from = exactly 09:00 → strictly after → tomorrow 09:00.
    expect(nextScheduledRunAt({ kind: 'daily', hour: 9, minute: 0 }, 9 * HOUR)).toBe(9 * HOUR + DAY);
  });

  it('weekly rolls to the chosen UTC weekday (0 = Sunday)', () => {
    // epoch 0 = Thursday (weekday 4). Next Sunday (weekday 0) 00:00 is 3 days later.
    expect(nextScheduledRunAt({ kind: 'weekly', weekday: 0, hour: 0, minute: 0 }, 0)).toBe(3 * DAY);
    // Same weekday at from → strictly after → +7 days.
    expect(nextScheduledRunAt({ kind: 'weekly', weekday: 4, hour: 0, minute: 0 }, 0)).toBe(7 * DAY);
  });

  it('cron "0 9 *" resolves to the next 09:00 UTC', () => {
    expect(nextScheduledRunAt({ kind: 'cron', expression: '0 9 *' }, 8 * HOUR)).toBe(9 * HOUR);
  });

  it('cron "*/15 * *" resolves to the next quarter-hour', () => {
    expect(nextScheduledRunAt({ kind: 'cron', expression: '*/15 * *' }, 7 * 60_000)).toBe(15 * 60_000);
  });

  it('malformed cron never fires', () => {
    expect(nextScheduledRunAt({ kind: 'cron', expression: '0 9 * *' }, 0)).toBeNull(); // 4 fields
  });
});

describe('isValidCronExpression', () => {
  it('accepts 3 well-formed fields', () => {
    expect(isValidCronExpression('0 9 *')).toBe(true);
    expect(isValidCronExpression('*/15 * *')).toBe(true);
    expect(isValidCronExpression('0,30 8,9 1')).toBe(true);
  });

  it('rejects wrong field count, bad tokens, and out-of-range steps', () => {
    expect(isValidCronExpression('0 9 * *')).toBe(false); // 4 fields
    expect(isValidCronExpression('0 9')).toBe(false); // 2 fields
    expect(isValidCronExpression('x 9 *')).toBe(false); // non-integer
    expect(isValidCronExpression('*/0 * *')).toBe(false); // step must be >= 1
    expect(isValidCronExpression('*/60 * *')).toBe(false); // step bounded to <= 59
  });
});

describe('effectiveSchedule', () => {
  const base: AutomationMeta = {
    providerId: 'rss',
    params: {},
    intervalMin: 15,
    enabled: true,
    credential: {} as AutomationMeta['credential'],
    runOnDeviceId: 'device-A',
    lastRunAt: null,
    lastError: null,
  };

  it('prefers the explicit schedule over intervalMin', () => {
    expect(effectiveSchedule({ ...base, schedule: { kind: 'daily', hour: 9, minute: 0 } })).toEqual({
      kind: 'daily',
      hour: 9,
      minute: 0,
    });
  });

  it('derives an interval from legacy intervalMin when no schedule', () => {
    expect(effectiveSchedule(base)).toEqual({ kind: 'interval', everyMin: 15 });
  });

  it('is null for a commands-only automation (intervalMin 0, no schedule)', () => {
    expect(effectiveSchedule({ ...base, intervalMin: 0 })).toBeNull();
  });
});
