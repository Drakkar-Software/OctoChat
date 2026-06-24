import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { glowShadow, motion, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Image } from 'expo-image';
import { PulseHalo } from '@/components/ui/PulseHalo';

const LOGO = require('../../../assets/images/logo.png') as number;
import { Reveal } from '@/components/ui/Reveal';
import { Txt } from '@/components/ui/Txt';

interface VerifiedSealProps {
  /** Hex fingerprint shown beneath the seal, revealed group-by-group. */
  fingerprint: string;
  /** Uppercase mono headline under the seal. */
  label?: string;
}

const SIZE = 104;

/** The cryptographic-trust payoff: the octopus disc blooms a one-shot "signal
 *  locked" pulse and the fingerprint surfaces in groups — for device pairing /
 *  unlock success, instead of a flat confirmation pill. Honors reduced motion. */
export function VerifiedSeal({ fingerprint, label = 'Verified' }: VerifiedSealProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const pop = useSharedValue(reduced ? 1 : 0.6);

  useEffect(() => {
    if (reduced) return;
    pop.set(withSequence(
      withTiming(1.08, { duration: motion.base, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: motion.base }),
    ));
  }, [pop, reduced]);

  const discStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.get() }] }));
  // 4-char groups for the staggered surface-in.
  const groups = fingerprint.match(/.{1,4}/g) ?? [fingerprint];

  return (
    <View style={styles.wrap}>
      <PulseHalo size={SIZE} color={colors.accent} rings={3}>
        <Animated.View
          style={[
            styles.disc,
            {
              width: SIZE,
              height: SIZE,
              borderRadius: SIZE / 2,
              backgroundColor: colors.accentBgStrong,
              borderColor: colors.accentBorderStrong,
              borderTopColor: colors.hairlineHi,
            },
            glowShadow(colors.glow, 0.5, 26),
            // Android draws the rounded-disc elevation shadow as a polygon; zero it
            // (web/iOS use boxShadow/shadow*). Same fix as HeroMark/EmptyState.
            { elevation: 0 },
            discStyle,
          ]}
        >
          <Image source={LOGO} style={{ width: Math.round(SIZE * 0.6), height: Math.round(SIZE * 0.6) }} contentFit="contain" />
        </Animated.View>
      </PulseHalo>
      <Txt variant="caption" weight="semibold" mono uppercase tone="accent" style={styles.label}>
        {label}
      </Txt>
      <View style={styles.fp}>
        {groups.map((g, i) =>
          reduced ? (
            <Txt key={i} variant="footnote" mono tone="accentInk">
              {g}
            </Txt>
          ) : (
            <Reveal key={i} delay={motion.base + i * motion.stagger.step} duration={motion.base}>
              <Txt variant="footnote" mono tone="accentInk">
                {g}
              </Txt>
            </Reveal>
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.sm },
  disc: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  label: { marginTop: spacing.sm },
  fp: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.xs },
});
