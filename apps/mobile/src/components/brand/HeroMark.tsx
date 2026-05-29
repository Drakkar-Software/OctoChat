import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { glowShadow, motion, radii } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { PulseHalo } from '@/components/ui/PulseHalo';

import { Octopus } from './Octopus';

interface HeroMarkProps {
  /** Diameter of the disc; the octopus scales to fit. */
  size?: number;
}

/**
 * The onboarding hero lockup: the octopus inside a glowing marine disc that
 * breathes (a slow vertical float) within a bioluminescent halo. Encapsulates
 * the motion so route pages stay declarative.
 */
export function HeroMark({ size = 128 }: HeroMarkProps) {
  const { colors } = useTheme();
  const float = useSharedValue(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    float.value = withRepeat(withTiming(1, { duration: motion.pulse, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(float);
  }, [float, reduced]);

  const floatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: reduced ? 0 : interpolate(float.value, [0, 1], [-5, 5]) }],
  }));

  return (
    <Animated.View style={floatStyle}>
      <PulseHalo size={size} color={colors.accent} rings={3}>
        <Animated.View
          style={[
            styles.disc,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: colors.accentBg,
              borderColor: colors.accentBorder,
              borderTopColor: colors.hairlineHi,
            },
            glowShadow(colors.glow, 0.3, 24),
            // Android renders the elevation shadow of this fully-rounded disc as a
            // polygon (the rounded-rect outline shadow degrades to a hexagon/octagon
            // at radius size/2) — the "weird shape" seen behind the mark. Web
            // (boxShadow) and iOS (shadow* props) draw a clean bloom and ignore
            // `elevation`, so zeroing it only strips Android's artifact. Same fix as EmptyState.
            { elevation: 0 },
          ]}
        >
          <Octopus size={Math.round(size * 0.64)} />
        </Animated.View>
      </PulseHalo>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  disc: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
