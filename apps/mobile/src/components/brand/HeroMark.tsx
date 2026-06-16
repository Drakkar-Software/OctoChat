import { useEffect } from 'react';
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

import { motion } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { PulseHalo } from '@/components/ui/PulseHalo';

import { Octopus } from './Octopus';

interface HeroMarkProps {
  /** Diameter of the logo; drives halo size too. */
  size?: number;
}

/**
 * The onboarding hero lockup: the vector octopus mark floating inside a
 * bioluminescent halo. Encapsulates the motion so route pages stay declarative.
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
        {/* Crisp vector mark — no PNG decode, no asset size; accent-colored to
            pulse with the halo's bioluminescent glow. */}
        <Octopus size={size} color={colors.accent} />
      </PulseHalo>
    </Animated.View>
  );
}
