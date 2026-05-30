import { StyleSheet, View } from 'react-native';

import { paperBorder, radii, spacing } from '@/theme';
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
        <View
          key={word}
          style={[styles.cell, paperBorder(colors, colors.lineFaint)]}
        >
          <View style={[styles.index, { backgroundColor: colors.accentBg }]}>
            <Txt variant="micro" mono weight="semibold" color={colors.accentInk}>
              {String(i + 1).padStart(2, '0')}
            </Txt>
          </View>
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
    gap: spacing.sm,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
  },
  index: {
    minWidth: 22,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: radii.xs,
    alignItems: 'center',
  },
});
