import { Pressable, StyleSheet, View } from 'react-native';

import { isValidCronExpression } from '@drakkar.software/octochat-sdk';
import type { AutomationSchedule } from '@drakkar.software/octochat-sdk';

import { radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { IconButton } from '@/components/ui/IconButton';
import { TextField } from '@/components/ui/TextField';
import { Txt } from '@/components/ui/Txt';

/** A scheduled-fetch cadence for an automated room.
 *  - `onOpen` fires every room open / background check (no time gate).
 *  - `intervalMin` minutes is the minimum gap (`0` = commands-only / off).
 *  - `schedule` (optional) carries a calendar cadence (daily / weekly / cron). When set
 *    it OVERRIDES `intervalMin` (which is held at 0) — see the SDK `AutomationMeta`.
 *  The interval presets and the calendar modes are mutually exclusive in the UI. */
export interface Cadence {
  intervalMin: number;
  onOpen: boolean;
  schedule?: AutomationSchedule;
}

/** Interval/onOpen presets, in display order. `onOpen` and the timed gaps are distinct
 *  pills — no magic `intervalMin` value stands in for "always". A preset never sets
 *  `schedule` (the calendar modes below own that). */
export const CADENCE_OPTIONS: { label: string; cadence: Cadence }[] = [
  { label: 'Off', cadence: { intervalMin: 0, onOpen: false } },
  { label: 'On open', cadence: { intervalMin: 0, onOpen: true } },
  { label: '15 min', cadence: { intervalMin: 15, onOpen: false } },
  { label: '30 min', cadence: { intervalMin: 30, onOpen: false } },
  { label: '1 h', cadence: { intervalMin: 60, onOpen: false } },
  { label: '6 h', cadence: { intervalMin: 360, onOpen: false } },
  { label: '24 h', cadence: { intervalMin: 1440, onOpen: false } },
];

/** Calendar-mode defaults, applied when switching INTO a mode from a preset. Times are
 *  UTC (the cadence engine evaluates daily/weekly/cron in UTC — see the SDK schedule.ts). */
const DAILY_DEFAULT: AutomationSchedule = { kind: 'daily', hour: 9, minute: 0 };
const WEEKLY_DEFAULT: AutomationSchedule = { kind: 'weekly', weekday: 1, hour: 9, minute: 0 };
const CRON_DEFAULT: AutomationSchedule = { kind: 'cron', expression: '0 9 *' };

/** Weekday labels indexed 0 = Sunday (matches the engine's UTC `getUTCDay`). */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const sameCadence = (a: Cadence, b: Cadence) => a.onOpen === b.onOpen && a.intervalMin === b.intervalMin;

type Mode = 'daily' | 'weekly' | 'cron';
const modeOf = (v: Cadence): Mode | null =>
  v.schedule?.kind === 'daily' || v.schedule?.kind === 'weekly' || v.schedule?.kind === 'cron'
    ? v.schedule.kind
    : null;

const pad2 = (n: number) => String(n).padStart(2, '0');
const wrap = (n: number, mod: number) => ((n % mod) + mod) % mod;

interface Props {
  value: Cadence;
  onChange: (cadence: Cadence) => void;
}

/** Schedule picker for automated rooms — a "Schedule" heading, a pill row of interval
 *  presets, a row of calendar modes (Daily / Weekly / Cron) with their inputs, and a
 *  cadence-specific note. Shared by the room creator and the settings sheet so the
 *  cadence UX and copy stay in one place. */
export function IntervalPicker({ value, onChange }: Props) {
  const { colors } = useTheme();
  const mode = modeOf(value);
  // Calendar modes hold intervalMin/onOpen at 0/false so a client without `schedule`
  // degrades to commands-only rather than mis-running an interval.
  const setSchedule = (schedule: AutomationSchedule) => onChange({ intervalMin: 0, onOpen: false, schedule });
  const hm = value.schedule && 'hour' in value.schedule ? value.schedule : null;

  return (
    <>
      <Txt variant="footnote" weight="semibold">
        Schedule
      </Txt>

      <View style={[styles.pillRow, { borderColor: colors.lineSoft }]}>
        {CADENCE_OPTIONS.map((opt) => {
          const on = !value.schedule && sameCadence(opt.cadence, value);
          return (
            <Pressable
              key={opt.label}
              accessibilityRole="button"
              onPress={() => onChange(opt.cadence)}
              style={[styles.pill, { backgroundColor: on ? colors.accentSoft : 'transparent' }]}
            >
              <Txt variant="caption" weight={on ? 'semibold' : 'regular'} color={on ? colors.accentInk : colors.inkMuted}>
                {opt.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.pillRow, { borderColor: colors.lineSoft }]}>
        {([
          { label: 'Daily', m: 'daily' as Mode, def: DAILY_DEFAULT },
          { label: 'Weekly', m: 'weekly' as Mode, def: WEEKLY_DEFAULT },
          { label: 'Cron', m: 'cron' as Mode, def: CRON_DEFAULT },
        ]).map((opt) => {
          const on = mode === opt.m;
          return (
            <Pressable
              key={opt.label}
              accessibilityRole="button"
              onPress={() => setSchedule(opt.def)}
              style={[styles.pill, { backgroundColor: on ? colors.accentSoft : 'transparent' }]}
            >
              <Txt variant="caption" weight={on ? 'semibold' : 'regular'} color={on ? colors.accentInk : colors.inkMuted}>
                {opt.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      {mode === 'weekly' && value.schedule?.kind === 'weekly' ? (
        <View style={[styles.pillRow, { borderColor: colors.lineSoft }]}>
          {WEEKDAYS.map((label, i) => {
            const on = value.schedule?.kind === 'weekly' && value.schedule.weekday === i;
            return (
              <Pressable
                key={label}
                accessibilityRole="button"
                onPress={() => setSchedule({ kind: 'weekly', weekday: i, hour: hm?.hour ?? 9, minute: hm?.minute ?? 0 })}
                style={[styles.pill, { backgroundColor: on ? colors.accentSoft : 'transparent' }]}
              >
                <Txt variant="caption" weight={on ? 'semibold' : 'regular'} color={on ? colors.accentInk : colors.inkMuted}>
                  {label}
                </Txt>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {(mode === 'daily' || mode === 'weekly') && hm ? (
        <View style={styles.timeRow}>
          <Stepper
            label="Hour"
            text={pad2(hm.hour)}
            onDec={() => setSchedule({ ...hm, hour: wrap(hm.hour - 1, 24) })}
            onInc={() => setSchedule({ ...hm, hour: wrap(hm.hour + 1, 24) })}
          />
          <Txt variant="title" tone="inkMuted">
            :
          </Txt>
          <Stepper
            label="Minute"
            text={pad2(hm.minute)}
            onDec={() => setSchedule({ ...hm, minute: wrap(hm.minute - 5, 60) })}
            onInc={() => setSchedule({ ...hm, minute: wrap(hm.minute + 5, 60) })}
          />
          <Txt variant="caption" tone="inkMuted">
            UTC
          </Txt>
        </View>
      ) : null}

      {mode === 'cron' && value.schedule?.kind === 'cron' ? (
        <CronField
          expression={value.schedule.expression}
          onChange={(expression) => setSchedule({ kind: 'cron', expression })}
        />
      ) : null}

      <CadenceNote value={value} />
    </>
  );
}

/** A compact `◀ value ▶` numeric stepper (wrap-around). Uses arrow icons since there's
 *  no dedicated minus glyph; reads naturally for HH / MM. */
function Stepper({ label, text, onDec, onInc }: { label: string; text: string; onDec: () => void; onInc: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.stepper, { borderColor: colors.lineSoft }]}>
      <IconButton name="arrow-l" size={16} onPress={onDec} accessibilityLabel={`${label} down`} color={colors.inkMuted} />
      <Txt variant="footnote" weight="semibold" mono style={styles.stepperValue}>
        {text}
      </Txt>
      <IconButton name="arrow-r" size={16} onPress={onInc} accessibilityLabel={`${label} up`} color={colors.inkMuted} />
    </View>
  );
}

/** Cron expression field with inline validity. 3 fields `minute hour day-of-week` (UTC),
 *  matching the SDK/engine parser. Validation mirrors `isValidCronExpression` so the
 *  creator/settings can block a write the engine would reject fail-fast. */
function CronField({ expression, onChange }: { expression: string; onChange: (e: string) => void }) {
  const { colors } = useTheme();
  const valid = isValidCronExpression(expression);
  return (
    <View style={styles.field}>
      <TextField value={expression} onChangeText={onChange} placeholder="0 9 *" autoCapitalize="none" autoCorrect={false} />
      <Txt variant="caption" color={valid ? colors.inkMuted : colors.warning}>
        {valid
          ? 'minute hour day-of-week (UTC). e.g. "0 9 *" = 09:00 daily; "*/15 * *" = every 15 min.'
          : 'Need 3 fields: minute hour day-of-week. Each * , a list (0,30), or */n.'}
      </Txt>
    </View>
  );
}

function CadenceNote({ value }: { value: Cadence }) {
  const note =
    value.schedule?.kind === 'daily'
      ? 'Runs once a day at the time above (UTC).'
      : value.schedule?.kind === 'weekly'
        ? 'Runs once a week on the selected day/time (UTC).'
        : value.schedule?.kind === 'cron'
          ? 'Runs on the cron schedule above (UTC).'
          : value.onOpen
            ? 'Runs every time the room opens (and on each background check).'
            : value.intervalMin > 0
              ? 'Runs exactly on schedule while the room is open. In the background the OS decides timing (best-effort, ~15 min minimum; paused while the device is off or locked).'
              : null;
  if (!note) return null;
  return (
    <Txt variant="caption" tone="inkMuted">
      {note}
    </Txt>
  );
}

const styles = StyleSheet.create({
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderRadius: radii.md, padding: 2, gap: 2 },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radii.sm },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 2 },
  stepperValue: { minWidth: 24, textAlign: 'center' },
  field: { gap: 4 },
});
