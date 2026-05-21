import { type ReactNode, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
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

interface PulseHaloProps {
  /** Diameter of the inner disc the rings emanate from. */
  size: number;
  /** Ring color. Defaults to the marine accent. */
  color?: string;
  /** Number of staggered rings. */
  rings?: number;
  /** Center content (an icon disc, the brand mark…). */
  children?: ReactNode;
}

function Ring({ size, color, phase }: { size: number; color: string; phase: number }) {
  const p = useSharedValue(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    p.value = withRepeat(withTiming(1, { duration: motion.pulse, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(p);
  }, [p, reduced]);

  const style = useAnimatedStyle(() => {
    // Reduced motion: a faint, still concentric ring instead of an expanding pulse.
    if (reduced) {
      return { opacity: 0.16, transform: [{ scale: 1 + phase * 0.5 }] };
    }
    const t = (p.value + phase) % 1;
    return {
      opacity: interpolate(t, [0, 0.1, 1], [0, 0.5, 0]),
      transform: [{ scale: interpolate(t, [0, 1], [1, 1.85]) }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        { width: size, height: size, borderRadius: size / 2, borderColor: color },
        style,
      ]}
    />
  );
}

/**
 * Bioluminescent halo: concentric rings that bloom outward from a centered disc
 * and fade — the app's signature "signal underwater" motion. Reanimated drives
 * it so it runs on web and native alike.
 */
export function PulseHalo({ size, color, rings = 2, children }: PulseHaloProps) {
  const { colors } = useTheme();
  const ringColor = color ?? colors.accent;
  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      {Array.from({ length: rings }).map((_, i) => (
        <Ring key={i} size={size} color={ringColor} phase={i / rings} />
      ))}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: 1.5 },
});
