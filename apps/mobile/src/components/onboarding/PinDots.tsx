import { StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';

interface PinDotsProps {
  length?: number;
  filled?: number;
}

/** Row of PIN slots; filled slots show a dot and an accent border. */
export function PinDots({ length = 6, filled = 0 }: PinDotsProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      {Array.from({ length }).map((_, i) => {
        const on = i < filled;
        return (
          <View
            key={i}
            style={[
              styles.slot,
              {
                borderColor: on ? colors.accent : colors.lineSoft,
                backgroundColor: on ? colors.accentBg : colors.paperAlt,
                borderTopColor: on ? colors.accent : colors.hairlineHi,
              },
            ]}
          >
            {on ? <View style={[styles.dot, { backgroundColor: colors.accent }]} /> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, justifyContent: 'center' },
  slot: {
    width: 32,
    height: 40,
    borderRadius: radii.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
});
