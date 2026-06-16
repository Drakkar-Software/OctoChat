import { StyleSheet, View } from 'react-native';

import { displayTracking, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { useBrand } from '@/lib/brand-context';
import { Txt } from '@/components/ui/Txt';

import { Octopus } from './Octopus';

interface WordmarkProps {
  /** Font size of the wordmark text; the mark scales with it. */
  size?: number;
  /** Override the ink color of "Octo" (the suffix half always uses the variant accent). */
  color?: string;
  /** Hide the octopus mark and render text only. */
  hideMark?: boolean;
}

/** "🐙 OctoChat" lockup — display type with the variant-accent-colored suffix. */
export function Wordmark({ size = 20, color, hideMark = false }: WordmarkProps) {
  const { colors } = useTheme();
  const { variant } = useBrand();
  const suffixColor = variant.accentToken === 'accentDesk' ? colors.accentDesk : colors.accent;
  // Both spans must share fontSize AND lineHeight — Txt always applies the variant's
  // own line height, so a bare nested <Txt> would shrink the suffix to body size. Keep a
  // little leading (~1.1×, the house display ratio) so the bold glyphs don't clip.
  const span = { fontSize: size, lineHeight: Math.round(size * 1.1), letterSpacing: displayTracking };
  return (
    <View style={styles.row}>
      {/* Vector mark scales crisply at any lockup size; tinted with the variant
          accent so it reads as a single brand unit with the colored suffix. */}
      {!hideMark && <Octopus size={size + 10} color={suffixColor} />}
      <Txt variant="display" color={color ?? colors.ink} style={span}>
        Octo
        <Txt variant="display" color={suffixColor} style={span}>
          {variant.wordmarkSuffix}
        </Txt>
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
