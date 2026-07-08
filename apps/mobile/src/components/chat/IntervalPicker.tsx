import { StyleSheet, View } from 'react-native';

import { isValidCronExpression } from '@drakkar.software/octochat-sdk';
import type { AutomationSchedule } from '@drakkar.software/octochat-sdk';

import { paperBorder, radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { ChoicePill } from '@/components/chat/ChoicePill';
import { TimeField } from '@/components/chat/TimeField';
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

/** Friendly cron starting points so most users tap an example rather than typing the
 *  3-field `minute hour day-of-week` (UTC) expression by hand. The raw field below
 *  stays as the power-user escape hatch. */
const CRON_EXAMPLES: { label: string; expression: string }[] = [
  { label: 'Every 15 min', expression: '*/15 * *' },
  { label: 'Hourly', expression: '0 * *' },
  { label: 'Daily 9am', expression: '0 9 *' },
  { label: 'Weekdays 9am', expression: '0 9 1,2,3,4,5' },
];

/** Weekday labels indexed 0 = Sunday (matches the engine's UTC `getUTCDay`). */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const sameCadence = (a: Cadence, b: Cadence) => a.onOpen === b.onOpen && a.intervalMin === b.intervalMin;

type Mode = 'daily' | 'weekly' | 'cron';
const modeOf = (v: Cadence): Mode | null =>
  v.schedule?.kind === 'daily' || v.schedule?.kind === 'weekly' || v.schedule?.kind === 'cron'
    ? v.schedule.kind
    : null;

interface Props {
  value: Cadence;
  onChange: (cadence: Cadence) => void;
  /** Suppress the built-in "Schedule" heading — for callers that already supply a section
   *  title (e.g. the settings sheet's `<Card title="Schedule">`) so the label isn't doubled
   *  and matches its sibling sections' uppercase-mono Card headers. Default shows it. */
  hideHeading?: boolean;
}

/** Schedule picker for automated rooms — a "Schedule" heading, a pill row of interval
 *  presets, a row of calendar modes (Daily / Weekly / Cron) with their inputs, and a
 *  cadence-specific note. Shared by the room creator and the settings sheet so the
 *  cadence UX and copy stay in one place. */
export function IntervalPicker({ value, onChange, hideHeading = false }: Props) {
  const { colors } = useTheme();
  const mode = modeOf(value);
  // Calendar modes hold intervalMin/onOpen at 0/false so a client without `schedule`
  // degrades to commands-only rather than mis-running an interval.
  const setSchedule = (schedule: AutomationSchedule) => onChange({ intervalMin: 0, onOpen: false, schedule });
  const hm = value.schedule && 'hour' in value.schedule ? value.schedule : null;

  return (
    <>
      {hideHeading ? null : (
        <Txt variant="footnote" weight="semibold">
          Schedule
        </Txt>
      )}

      <View style={[styles.pillRow, paperBorder(colors)]}>
        {CADENCE_OPTIONS.map((opt) => (
          <ChoicePill
            key={opt.label}
            label={opt.label}
            active={!value.schedule && sameCadence(opt.cadence, value)}
            onPress={() => onChange(opt.cadence)}
          />
        ))}
      </View>

      <View style={[styles.pillRow, paperBorder(colors)]}>
        {([
          { label: 'Daily', m: 'daily' as Mode, def: DAILY_DEFAULT },
          { label: 'Weekly', m: 'weekly' as Mode, def: WEEKLY_DEFAULT },
          { label: 'Cron', m: 'cron' as Mode, def: CRON_DEFAULT },
        ]).map((opt) => (
          <ChoicePill key={opt.label} label={opt.label} active={mode === opt.m} onPress={() => setSchedule(opt.def)} />
        ))}
      </View>

      {mode === 'weekly' && value.schedule?.kind === 'weekly' ? (
        <View style={[styles.pillRow, paperBorder(colors)]}>
          {WEEKDAYS.map((label, i) => (
            <ChoicePill
              key={label}
              label={label}
              active={value.schedule?.kind === 'weekly' && value.schedule.weekday === i}
              onPress={() => setSchedule({ kind: 'weekly', weekday: i, hour: hm?.hour ?? 9, minute: hm?.minute ?? 0 })}
            />
          ))}
        </View>
      ) : null}

      {(mode === 'daily' || mode === 'weekly') && hm ? (
        <TimeField
          hour={hm.hour}
          minute={hm.minute}
          onChange={(hour, minute) => setSchedule({ ...hm, hour, minute })}
        />
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

/** Cron expression field with inline validity. 3 fields `minute hour day-of-week` (UTC),
 *  matching the SDK/engine parser. Most users tap an example chip (which fills the
 *  expression); the raw field is the power-user escape hatch — framed as a recessed mono
 *  "code" well with an accent/warning hairline that tracks validity. Validation mirrors
 *  `isValidCronExpression` so the creator/settings can block a write the engine would
 *  reject fail-fast. */
function CronField({ expression, onChange }: { expression: string; onChange: (e: string) => void }) {
  const { colors } = useTheme();
  const valid = isValidCronExpression(expression);
  return (
    <View style={styles.field}>
      <View style={[styles.pillRow, paperBorder(colors)]}>
        {CRON_EXAMPLES.map((ex) => (
          <ChoicePill
            key={ex.label}
            label={ex.label}
            active={expression.trim() === ex.expression}
            onPress={() => onChange(ex.expression)}
          />
        ))}
      </View>
      {/* The raw expression is the power-user escape hatch — framed as deliberate "code"
          (mono value) with a lit hairline that flips to warning when the expression won't
          parse, instead of a generic text box. */}
      <View
        style={[
          styles.cronFrame,
          paperBorder(colors, valid ? colors.accentBorder : colors.warningBorder),
          // Recessed code well: keep the lit top edge from paperBorder but sit the value
          // on the inset paperAlt fill so it reads as a CopyField-style code block.
          { backgroundColor: colors.paperAlt },
        ]}
      >
        <TextField
          value={expression}
          onChangeText={onChange}
          placeholder="0 9 *"
          autoCapitalize="none"
          autoCorrect={false}
          mono
          plain
        />
      </View>
      <Txt variant="caption" color={valid ? colors.inkMuted : colors.warning}>
        {valid
          ? 'minute hour day-of-week (UTC). Tap an example above or edit the expression.'
          : 'Need 3 fields: minute hour day-of-week. Each * , a list (0,30), or */n.'}
      </Txt>
    </View>
  );
}

/** Plain-words description of a cadence — the single source for the cadence copy, shared
 *  by the in-picker note and the read-only member detail (auto-13). `standalone` swaps the
 *  picker-relative "above" phrasing for self-contained wording when there are no controls
 *  to point at. Returns null for "Off". */
export function cadenceNote(value: Cadence, standalone = false): string | null {
  if (value.schedule?.kind === 'daily')
    return standalone ? 'Runs once a day (UTC).' : 'Runs once a day at the time above (UTC).';
  if (value.schedule?.kind === 'weekly')
    return standalone ? 'Runs once a week (UTC).' : 'Runs once a week on the selected day/time (UTC).';
  if (value.schedule?.kind === 'cron')
    return standalone ? 'Runs on a cron schedule (UTC).' : 'Runs on the cron schedule above (UTC).';
  if (value.onOpen) return 'Runs every time the room opens (and on each background check).';
  if (value.intervalMin > 0)
    return 'Runs exactly on schedule while the room is open. In the background the OS decides timing (best-effort, ~15 min minimum; paused while the device is off or locked).';
  return null;
}

function CadenceNote({ value }: { value: Cadence }) {
  const note = cadenceNote(value);
  if (!note) return null;
  return (
    <Txt variant="caption" tone="inkMuted">
      {note}
    </Txt>
  );
}

const styles = StyleSheet.create({
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderRadius: radii.md, padding: 2, gap: 2 },
  field: { gap: spacing.xs },
  cronFrame: { borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
});
