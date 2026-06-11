import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { glowShadow, layout, radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Image } from 'expo-image';
import { Txt } from '@/components/ui/Txt';

const LOGO = require('../../../assets/images/logo.png') as number;

interface AccountFlowHeaderProps {
  /** Display title for the step (e.g. "Add account"). */
  title: string;
  /** One-line value framing under the title. */
  subtitle?: string;
}

/**
 * Shared brand chrome for the account-management flow (add / create / recover /
 * add-device). A compact octopus mark in a glowing marine disc over a
 * depthTop→depthBottom wash, so these identity moments carry the same front-door
 * atmosphere as onboarding instead of reading as bare form scaffolding. Static
 * (no breathing float) — these are utility steps, not the hero — but the accent
 * glow keeps the brand alive on the screen.
 */
export function AccountFlowHeader({ title, subtitle }: AccountFlowHeaderProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.disc,
          { backgroundColor: colors.accentBg, borderColor: colors.accentBorder, borderTopColor: colors.hairlineHi },
          glowShadow(colors.glow, 0.28, 18),
          // Android draws the fully-rounded elevation shadow as a polygon; web/iOS
          // ignore `elevation` and bloom cleanly. Same fix as HeroMark/EmptyState.
          { elevation: 0 },
        ]}
      >
        <LinearGradient
          colors={[colors.depthTop, colors.depthBottom]}
          style={[StyleSheet.absoluteFill, styles.discFill]}
        />
        <Image source={LOGO} style={{ width: 36, height: 36 }} contentFit="contain" />
      </View>
      <Txt variant="title" weight="bold" center>
        {title}
      </Txt>
      {subtitle ? (
        <Txt variant="footnote" tone="inkSoft" center style={styles.subtitle}>
          {subtitle}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.sm },
  disc: {
    width: 72,
    height: 72,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  discFill: { borderRadius: radii.pill },
  subtitle: { maxWidth: layout.emptyStateMaxWidth },
});
