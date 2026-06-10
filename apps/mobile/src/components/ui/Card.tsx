import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, View } from 'react-native';

import { paperBorder, radii, shadows, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';

import { Txt } from './Txt';

/** Surface treatment: `paper` (default raised), `accent` (featured — accent-lit
 *  edge), `inset` (recessed well — no lift). */
export type CardTone = 'paper' | 'accent' | 'inset';
/** Drop-shadow depth; activates the theme elevation ramp. `inset` ignores this. */
export type CardElevation = 'none' | 'sm' | 'md' | 'lg';

interface CardProps {
  title?: string;
  children: ReactNode;
  padded?: boolean;
  /** Surface treatment. Default `paper` (unchanged from before). */
  tone?: CardTone;
  /** Shadow depth. Default `sm` (unchanged from before). */
  elevation?: CardElevation;
  style?: StyleProp<ViewStyle>;
}

/** Paper section with an optional uppercase mono title. `tone`/`elevation` let a
 *  screen express a featured or recessed card and break stacked-paper monotony;
 *  the defaults reproduce the original raised paper card exactly. */
export function Card({ title, children, padded = true, tone = 'paper', elevation = 'sm', style }: CardProps) {
  const { colors } = useTheme();

  const surface =
    tone === 'inset'
      ? { backgroundColor: colors.paperAlt, borderColor: colors.lineFaint }
      : tone === 'accent'
        ? paperBorder(colors, colors.accentBorder)
        : paperBorder(colors);

  return (
    <View
      style={[
        styles.card,
        surface,
        padded && styles.padded,
        // Recessed wells don't float; everything else uses the elevation ramp.
        tone === 'inset' ? shadows.none : shadows[elevation],
        style,
      ]}
    >
      {title ? (
        <Txt variant="caption" weight="semibold" mono uppercase tone="inkSoft">
          {title}
        </Txt>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.md,
  },
  padded: { padding: spacing.lg },
});
