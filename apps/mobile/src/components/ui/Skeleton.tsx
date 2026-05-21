import { useEffect } from 'react';
import type { DimensionValue, StyleProp, ViewStyle } from 'react-native';
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

import { motion, radii } from '@/theme';
import { useTheme } from '@/lib/use-theme';

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/** Single shimmering placeholder block — compose these into loading layouts
 *  that mirror the real content, so loads feel like the UI filling in. */
export function Skeleton({ width = '100%', height = 12, radius = radii.xs, style }: SkeletonProps) {
  const { colors } = useTheme();
  const p = useSharedValue(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    p.value = withRepeat(withTiming(1, { duration: motion.shimmer, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(p);
  }, [p, reduced]);

  const animStyle = useAnimatedStyle(() => ({ opacity: reduced ? 0.6 : interpolate(p.value, [0, 1], [0.35, 0.7]) }));

  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.fillDeep }, animStyle, style]}
    />
  );
}
