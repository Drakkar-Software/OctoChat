/**
 * Pure cadence math for automated rooms — when does a {@link AutomationSchedule}
 * next fire after a given instant?
 *
 * The headless SDK does NOT depend on `@drakkar.software/expo-conductor`; the app
 * hands the same schedule to the scheduler engine (which owns the OS wake) AND to
 * this gate (`isDueForScheduledTick`, the cross-device source of truth over the
 * synced `lastRunAt`). For the wake and the gate to agree, the daily/weekly/cron
 * math here MIRRORS the engine's recurrence engine bit-for-bit:
 *   - all in **UTC** (day boundaries at UTC midnight, time-of-day offsets UTC);
 *   - weekday `0 = Sunday` (JS `getUTCDay`);
 *   - cron is 3 fields `minute hour dayOfWeek`, ASCII-whitespace split, strict
 *     integer tokens, `*​/n` step bounded to 1..59.
 * Using UTC (not local time) also sidesteps DST. `interval` stays anchored to
 * `lastRunAt` (`from + everyMs`) — the legacy "minimum gap" semantics, unchanged.
 */
import type { AutomationMeta, AutomationSchedule } from '../domain/types';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** UTC day-of-week with 0 = Sunday (matches JS `getUTCDay` and the engine). */
function dayOfWeek(epochMs: number): number {
  const epochDay = Math.floor(epochMs / MS_PER_DAY);
  return ((epochDay % 7) + 4 + 7) % 7;
}

function timeOfDayOffset(hour: number, minute: number): number {
  return hour * MS_PER_HOUR + minute * MS_PER_MINUTE;
}

/** Strict integer token parse: "30" → 30; "30abc" / "" / "*" → null. Mirrors the
 *  engine (lenient `parseInt` would diverge — "30abc" → 30 there but null here). */
function parseIntStrict(token: string): number | null {
  return /^[+-]?\d+$/.test(token) ? Number(token) : null;
}

/** Split a cron expression into its three fields, or null when malformed (not exactly
 *  three). Splits on ASCII whitespace only (space/tab/newline/CR), not Unicode `\s`,
 *  so the split is identical to the engine's. */
function parseCronFields(expression: string): [string, string, string] | null {
  const fields = expression.split(/[ \t\n\r]+/).filter((f) => f.length > 0);
  return fields.length === 3 ? (fields as [string, string, string]) : null;
}

function isValidCronField(field: string): boolean {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const step = parseIntStrict(field.slice(2));
    // Bounded to 1..59 — a larger step is nonsensical and overflowed the engine's
    // 32-bit Int paths; keeping the cap identical preserves cross-engine parity.
    return step != null && step > 0 && step <= 59;
  }
  return field.split(',').every((p) => parseIntStrict(p) != null) && field.length > 0;
}

/** Whether a cron expression is well-formed (exactly three fields, each `*`,
 *  `*​/<+int 1..59>`, or a comma list of integers). Exported so the creator UI can
 *  reject a typo before the write — the 0.2.0 engine throws on a bad cron at
 *  registration, which would otherwise break reconcile for sibling rooms. */
export function isValidCronExpression(expression: string): boolean {
  const fields = parseCronFields(expression);
  return fields != null && fields.every(isValidCronField);
}

function matchCronField(field: string, value: number): boolean {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const step = parseIntStrict(field.slice(2));
    return step != null && step > 0 && step <= 59 && value % step === 0;
  }
  return field.split(',').some((part) => parseIntStrict(part) === value);
}

/** Search bound for cron resolution: ~366 days of minutes. */
const CRON_MAX_ITERATIONS = 366 * 24 * 60;

function nextCron(expression: string, fromMs: number): number | null {
  const fields = parseCronFields(expression);
  if (fields == null) return null; // malformed → never fires (parity with the engine)
  const [minuteField, hourField, dowField] = fields;
  let candidate = (Math.floor(fromMs / MS_PER_MINUTE) + 1) * MS_PER_MINUTE;
  for (let i = 0; i < CRON_MAX_ITERATIONS; i++) {
    const minute = Math.floor(candidate / MS_PER_MINUTE) % 60;
    const hour = Math.floor(candidate / MS_PER_HOUR) % 24;
    const dow = dayOfWeek(candidate);
    if (
      matchCronField(minuteField, minute) &&
      matchCronField(hourField, hour) &&
      matchCronField(dowField, dow)
    ) {
      return candidate;
    }
    candidate += MS_PER_MINUTE;
  }
  return null;
}

/**
 * The next fire time STRICTLY after `fromMs` for a schedule, or `null` if it will
 * never fire again. `interval` is anchored to `fromMs` (legacy min-gap); calendar
 * kinds mirror the scheduler engine's UTC math.
 */
export function nextScheduledRunAt(schedule: AutomationSchedule, fromMs: number): number | null {
  switch (schedule.kind) {
    case 'interval': {
      if (schedule.everyMin <= 0) return null;
      return fromMs + schedule.everyMin * MS_PER_MINUTE;
    }
    case 'daily': {
      const offset = timeOfDayOffset(schedule.hour, schedule.minute);
      const dayStart = Math.floor(fromMs / MS_PER_DAY) * MS_PER_DAY;
      let candidate = dayStart + offset;
      while (candidate <= fromMs) candidate += MS_PER_DAY;
      return candidate;
    }
    case 'weekly': {
      const offset = timeOfDayOffset(schedule.hour, schedule.minute);
      const dayStart = Math.floor(fromMs / MS_PER_DAY) * MS_PER_DAY;
      const dow = dayOfWeek(fromMs);
      const daysUntil = (((schedule.weekday - dow) % 7) + 7) % 7;
      let candidate = dayStart + daysUntil * MS_PER_DAY + offset;
      while (candidate <= fromMs) candidate += 7 * MS_PER_DAY;
      return candidate;
    }
    case 'cron':
      return nextCron(schedule.expression, fromMs);
    default:
      return null;
  }
}

/**
 * Resolve the effective cadence of an automation: the explicit `schedule` when set,
 * else derived from the legacy `intervalMin` (`>0` → interval), else `null` for a
 * commands-only automation (no scheduled run). The single place the legacy fallback
 * lives, shared by the timing gate and the app's trigger builder.
 */
export function effectiveSchedule(a: AutomationMeta): AutomationSchedule | null {
  if (a.schedule) return a.schedule;
  if (a.intervalMin > 0) return { kind: 'interval', everyMin: a.intervalMin };
  return null;
}
