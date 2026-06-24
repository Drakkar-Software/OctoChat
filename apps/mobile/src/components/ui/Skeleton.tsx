import { useEffect } from 'react';
import type { DimensionValue, StyleProp, ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
  /** Sweep a directional light highlight across the block ("UI filling in / light
   *  across water") instead of the default breathing opacity pulse. Opt-in so dense
   *  lists can keep the cheaper pulse; always falls back to a static block under
   *  reduced motion. */
  shimmer?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Single placeholder block — compose these into loading layouts that mirror the
 *  real content, so loads feel like the UI filling in. */
export function Skeleton({ width = '100%', height = 12, radius = radii.xs, shimmer = false, style }: SkeletonProps) {
  const { colors } = useTheme();
  const p = useSharedValue(0);
  const w = useSharedValue(0);
  const reduced = useReducedMotion();
  const useShimmer = shimmer && !reduced;

  useEffect(() => {
    if (reduced) return;
    // Sweep travels one direction on a loop; the pulse yoyos.
    p.set(withRepeat(
      withTiming(1, { duration: motion.shimmer, easing: Easing.inOut(Easing.ease) }),
      -1,
      !shimmer,
    ));
    return () => cancelAnimation(p);
  }, [p, reduced, shimmer]);

  const blockStyle = useAnimatedStyle(() => ({
    opacity: reduced ? 0.6 : useShimmer ? 1 : interpolate(p.get(), [0, 1], [0.35, 0.7]),
  }));
  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(p.get(), [0, 1], [-w.get(), w.get()]) }],
  }));

  return (
    <Animated.View
      onLayout={useShimmer ? (e) => w.set(e.nativeEvent.layout.width) : undefined}
      style={[
        { width, height, borderRadius: radius, backgroundColor: colors.fillDeep },
        useShimmer && styles.clip,
        blockStyle,
        style,
      ]}
    >
      {useShimmer ? (
        <Animated.View style={[StyleSheet.absoluteFill, sweepStyle]}>
          <LinearGradient
            colors={['transparent', colors.brightWash, 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
