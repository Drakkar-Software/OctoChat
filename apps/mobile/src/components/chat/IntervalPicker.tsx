import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Txt } from '@/components/ui/Txt';

/** A scheduled-fetch cadence for an automated room. `onOpen` fires every room
 *  open / background check (no time gate); otherwise `intervalMin` minutes is the
 *  minimum gap (`0` = commands-only / off). The two are mutually exclusive in the UI. */
export interface Cadence {
  intervalMin: number;
  onOpen: boolean;
}

/** Cadence presets, in display order. `onOpen` and the timed gaps are distinct
 *  pills — no magic `intervalMin` value stands in for "always". */
export const CADENCE_OPTIONS: { label: string; cadence: Cadence }[] = [
  { label: 'Off', cadence: { intervalMin: 0, onOpen: false } },
  { label: 'On open', cadence: { intervalMin: 0, onOpen: true } },
  { label: '15 min', cadence: { intervalMin: 15, onOpen: false } },
  { label: '30 min', cadence: { intervalMin: 30, onOpen: false } },
  { label: '1 h', cadence: { intervalMin: 60, onOpen: false } },
  { label: '6 h', cadence: { intervalMin: 360, onOpen: false } },
  { label: '24 h', cadence: { intervalMin: 1440, onOpen: false } },
];

const sameCadence = (a: Cadence, b: Cadence) => a.onOpen === b.onOpen && a.intervalMin === b.intervalMin;

interface Props {
  value: Cadence;
  onChange: (cadence: Cadence) => void;
}

/** Schedule picker for automated rooms — a "Schedule" heading, a pill row of
 *  cadence presets, and a cadence-specific note. Shared by the room creator and
 *  the settings sheet so the cadence UX and copy stay in one place. */
export function IntervalPicker({ value, onChange }: Props) {
  const { colors } = useTheme();
  return (
    <>
      <Txt variant="footnote" weight="semibold">
        Schedule
      </Txt>
      <View style={[styles.pillRow, { borderColor: colors.lineSoft }]}>
        {CADENCE_OPTIONS.map((opt) => {
          const on = sameCadence(opt.cadence, value);
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
      {value.onOpen ? (
        <Txt variant="caption" tone="inkMuted">
          Runs every time the room opens (and on each background check).
        </Txt>
      ) : value.intervalMin > 0 ? (
        <Txt variant="caption" tone="inkMuted">
          Runs exactly on schedule while the room is open. In the background the OS decides
          timing (best-effort, ~15 min minimum; paused while the device is off or locked).
        </Txt>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderRadius: radii.md, padding: 2, gap: 2 },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radii.sm },
});
