import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { motion } from '@/theme';
import { tapFeedback } from '@/lib/haptics';

interface ScalePressOptions {
  /** Scale at full press (1 = none). Default 0.97. */
  scaleTo?: number;
  /** Opacity at full press (1 = none). Default 1. */
  fadeTo?: number;
}

/**
 * The shared press-spring for tappable controls: a quick scale (and optional
 * opacity) dip on press-in, springing back on release, with a haptic tap. Drives
 * a single `t` (0 rest → 1 pressed) so callers stay declarative.
 *
 * Spread the handlers onto a Pressable and apply `animStyle` to its
 * `Animated.View`/`AnimatedPressable`:
 *
 *     const { animStyle, onPressIn, onPressOut } = useScalePress({ scaleTo: 0.86, fadeTo: 0.7 });
 */
export function useScalePress({ scaleTo = 0.97, fadeTo = 1 }: ScalePressOptions = {}) {
  const t = useSharedValue(0);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + (scaleTo - 1) * t.value }],
    opacity: 1 + (fadeTo - 1) * t.value,
  }));
  const onPressIn = () => {
    t.value = withTiming(1, { duration: motion.fast });
    tapFeedback();
  };
  const onPressOut = () => {
    t.value = withTiming(0, { duration: motion.fast });
  };
  return { t, animStyle, onPressIn, onPressOut };
}
