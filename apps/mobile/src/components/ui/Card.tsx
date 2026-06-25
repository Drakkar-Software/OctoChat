import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, View } from 'react-native';

import { getElevation, radii, spacing } from '@/theme';
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
  const elev = getElevation(colors);

  // Resolve surface/border/topHairline/shadow from the elevation scale.
  // inset → e1 (recessed well, no shadow, no top hairline)
  // paper → e2 at rest; e3 for elevation="sm"; e4 for elevation="md"/"lg"
  // accent → same paper surface tier but with accent border + strong top hairline
  let surfaceStyle: {
    backgroundColor: string;
    borderColor: string;
    borderTopColor: string;
  };
  let shadowStyle: object;

  if (tone === 'inset') {
    surfaceStyle = {
      backgroundColor: elev.e1.surface,
      borderColor: elev.e1.border,
      borderTopColor: elev.e1.topHairline,
    };
    shadowStyle = elev.e1.shadow;
  } else if (tone === 'accent') {
    // Accent cards use accentBg surface + accent border, same shadow tier as paper.
    const tier = elevation === 'none' ? elev.e2 : elevation === 'sm' ? elev.e3 : elev.e4;
    surfaceStyle = {
      backgroundColor: colors.accentBg,
      borderColor: colors.accentBorder,
      borderTopColor: colors.hairlineHi,
    };
    shadowStyle = tier.shadow;
  } else {
    // paper: resting = e2 (no shadow), sm = e3, md/lg = e4
    const tier = elevation === 'none' ? elev.e2 : elevation === 'sm' ? elev.e3 : elev.e4;
    surfaceStyle = {
      backgroundColor: tier.surface,
      borderColor: tier.border,
      borderTopColor: tier.topHairline,
    };
    shadowStyle = tier.shadow;
  }

  return (
    <View
      style={[
        styles.card,
        surfaceStyle,
        shadowStyle,
        padded && styles.padded,
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
