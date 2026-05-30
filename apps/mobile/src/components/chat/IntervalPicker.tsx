import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Txt } from '@/components/ui/Txt';

/** Scheduled-fetch cadence presets for automated rooms. `0` = commands-only. */
export const INTERVAL_OPTIONS: { label: string; min: number }[] = [
  { label: 'Off', min: 0 },
  { label: '15 min', min: 15 },
  { label: '30 min', min: 30 },
  { label: '1 h', min: 60 },
  { label: '6 h', min: 360 },
  { label: '24 h', min: 1440 },
];

interface Props {
  value: number;
  onChange: (min: number) => void;
}

/** Schedule picker for automated rooms — a "Schedule" heading, a pill row of
 *  interval presets, and a best-effort-in-background note (shown once a cadence is
 *  set). Shared by the room creator and the settings sheet so the cadence UX and
 *  copy stay in one place. */
export function IntervalPicker({ value, onChange }: Props) {
  const { colors } = useTheme();
  return (
    <>
      <Txt variant="footnote" weight="semibold">
        Schedule
      </Txt>
      <View style={[styles.pillRow, { borderColor: colors.lineSoft }]}>
        {INTERVAL_OPTIONS.map((opt) => {
          const on = opt.min === value;
          return (
            <Pressable
              key={opt.min}
              accessibilityRole="button"
              onPress={() => onChange(opt.min)}
              style={[styles.pill, { backgroundColor: on ? colors.accentSoft : 'transparent' }]}
            >
              <Txt variant="caption" weight={on ? 'semibold' : 'regular'} color={on ? colors.accentInk : colors.inkMuted}>
                {opt.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
      {value > 0 ? (
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
