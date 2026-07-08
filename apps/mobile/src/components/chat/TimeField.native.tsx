import { Platform, StyleSheet, View } from 'react-native';
import { DateTimePicker } from '@octochat/ui';

import { spacing } from '@/theme';
import { tapFeedback } from '@/lib/haptics';
import { Txt } from '@/components/ui/Txt';

import { TimeField as SteppersTimeField, type TimeFieldProps } from './TimeField';

/**
 * iOS renders a native time spinner (the schedule's UTC hour/minute are treated
 * as a plain HH:MM wall-clock, so the spinner shows exactly the UTC numbers and
 * stays labelled UTC). Android keeps the steppers (a native inline time wheel
 * isn't available in Material 3). Web uses the base sibling.
 */
export function TimeField({ hour, minute, onChange }: TimeFieldProps) {
  if (Platform.OS !== 'ios') {
    return <SteppersTimeField hour={hour} minute={minute} onChange={onChange} />;
  }
  // Build a fixed-day local Date whose wall-clock HH:MM equals the UTC hour/minute,
  // then read the picked wall-clock back as the UTC value (timezone-agnostic).
  const value = new Date(2001, 0, 1, hour, minute, 0, 0);
  return (
    <View style={styles.row}>
      <DateTimePicker
        value={value}
        mode="time"
        onChange={(date) => {
          const h = date.getHours();
          const m = date.getMinutes();
          if (h === hour && m === minute) return;
          tapFeedback();
          onChange(h, m);
        }}
      />
      <Txt variant="caption" tone="inkMuted">
        UTC
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
