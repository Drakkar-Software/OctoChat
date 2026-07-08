import { StyleSheet, View } from 'react-native';

import { paperBorder, radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';

export interface TimeFieldProps {
  /** UTC hour 0-23 (displayed verbatim — the value IS the UTC wall-clock hour). */
  hour: number;
  /** UTC minute 0-59. */
  minute: number;
  onChange: (hour: number, minute: number) => void;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const wrap = (n: number, mod: number) => ((n % mod) + mod) % mod;

/**
 * HH:MM chooser for the daily/weekly automation schedule (UTC). Web/Android use
 * the `◀ value ▶` steppers; iOS swaps in a native time spinner via the `.native`
 * sibling. The displayed numbers are the raw UTC hour/minute (labelled UTC).
 */
export function TimeField({ hour, minute, onChange }: TimeFieldProps) {
  return (
    <View style={styles.timeRow}>
      <Stepper
        label="Hour"
        text={pad2(hour)}
        onDec={() => onChange(wrap(hour - 1, 24), minute)}
        onInc={() => onChange(wrap(hour + 1, 24), minute)}
      />
      <Txt variant="title" tone="inkMuted">
        :
      </Txt>
      <Stepper
        label="Minute"
        text={pad2(minute)}
        onDec={() => onChange(hour, wrap(minute - 5, 60))}
        onInc={() => onChange(hour, wrap(minute + 5, 60))}
      />
      <Txt variant="caption" tone="inkMuted">
        UTC
      </Txt>
    </View>
  );
}

/** A compact `◀ value ▶` numeric stepper (wrap-around). Uses arrow icons since there's
 *  no dedicated minus glyph; reads naturally for HH / MM. */
function Stepper({ label, text, onDec, onInc }: { label: string; text: string; onDec: () => void; onInc: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.stepper, paperBorder(colors)]}>
      <IconButton name="arrow-l" size={16} onPress={onDec} accessibilityLabel={`${label} down`} color={colors.inkMuted} />
      <Txt variant="footnote" weight="semibold" mono style={styles.stepperValue}>
        {text}
      </Txt>
      <IconButton name="arrow-r" size={16} onPress={onInc} accessibilityLabel={`${label} up`} color={colors.inkMuted} />
    </View>
  );
}

const styles = StyleSheet.create({
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 2 },
  stepperValue: { minWidth: 24, textAlign: 'center' },
});
