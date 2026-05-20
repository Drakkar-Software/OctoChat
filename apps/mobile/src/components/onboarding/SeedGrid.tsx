import { StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Txt } from '@/components/ui/Txt';

interface SeedGridProps {
  words: readonly string[];
  /** Mask the words (e.g. before the user taps "reveal"). */
  concealed?: boolean;
}

/** 2-column numbered grid of recovery-seed words inside a dashed accent frame. */
export function SeedGrid({ words, concealed = false }: SeedGridProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.grid, { backgroundColor: colors.paperAlt, borderColor: colors.accentBorder }]}>
      {words.map((word, i) => (
        <View key={word} style={[styles.cell, { backgroundColor: colors.paper, borderColor: colors.lineFaint }]}>
          <Txt variant="micro" mono tone="inkMuted" style={styles.index}>
            {String(i + 1).padStart(2, '0')}
          </Txt>
          <Txt variant="footnote" mono weight="medium">
            {concealed ? '••••••' : word}
          </Txt>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.xs,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
  },
  index: { width: 16 },
});
