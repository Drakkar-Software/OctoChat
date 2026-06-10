import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { motion, radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';

interface PinDotsProps {
  length?: number;
  filled?: number;
  /** Bump this (e.g. a counter, or a fresh object) on a wrong-PIN attempt to play a
   *  short horizontal shake + danger border flash. Reduced-motion: a static no-op. */
  shake?: unknown;
}

/** A single PIN slot — springs its dot in when it fills (reduced-motion: instant). */
function PinSlot({ on, shakeKey }: { on: boolean; shakeKey: unknown }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const pop = useSharedValue(on ? 1 : 0);
  const flash = useSharedValue(0);
  // Skip the pop on first mount; only a fill *transition* (off → on) should spring.
  const mounted = useRef(false);
  const prevOn = useRef(on);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      prevOn.current = on;
      return;
    }
    if (on === prevOn.current) return;
    prevOn.current = on;
    if (reduced) {
      pop.value = on ? 1 : 0;
    } else if (on) {
      pop.value = 0;
      pop.value = withSpring(1, motion.spring);
    } else {
      pop.value = withTiming(0, { duration: motion.fast });
    }
  }, [on, reduced, pop]);

  // Danger border flash on a wrong-PIN shake (a brief tint that decays). No
  // first-mount guard: the row REMOUNTS on each failed attempt (the pad swaps to a
  // spinner while busy), so the guard would swallow the very render carrying the
  // bump. Instead gate on a truthy trigger — falsy on the genuine first mount.
  useEffect(() => {
    if (reduced || !shakeKey) return;
    flash.value = withSequence(withTiming(1, { duration: motion.fast }), withTiming(0, { duration: motion.base }));
  }, [shakeKey, reduced, flash]);

  const dotStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }], opacity: pop.value }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  return (
    <View
      style={[
        styles.slot,
        {
          borderColor: on ? colors.accent : colors.lineSoft,
          backgroundColor: on ? colors.accentBg : colors.paperAlt,
          borderTopColor: on ? colors.accent : colors.hairlineHi,
        },
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.flash, { borderColor: colors.danger }, flashStyle]}
      />
      <Animated.View style={[styles.dot, { backgroundColor: colors.accent }, dotStyle]} />
    </View>
  );
}

/** Row of PIN slots; filled slots spring a dot in. Pass `shake` to flag a wrong PIN. */
export function PinDots({ length = 6, filled = 0, shake }: PinDotsProps) {
  const reduced = useReducedMotion();
  const shift = useSharedValue(0);

  // No first-mount guard: the row REMOUNTS on each failed attempt (the pad swaps to a
  // spinner while busy), so a guard would swallow the bump. Gate on a truthy trigger —
  // the shake counter is 0/undefined on first mount and ≥1 on a post-error remount.
  useEffect(() => {
    if (reduced || !shake) return;
    shift.value = withSequence(
      withTiming(-SHAKE_AMP, { duration: motion.fast / 2 }),
      withTiming(SHAKE_AMP, { duration: motion.fast }),
      withTiming(-SHAKE_AMP, { duration: motion.fast }),
      withTiming(0, { duration: motion.fast / 2 }),
    );
  }, [shake, reduced, shift]);

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shift.value }] }));

  return (
    <Animated.View style={[styles.row, rowStyle]}>
      {Array.from({ length }).map((_, i) => (
        <PinSlot key={i} on={i < filled} shakeKey={shake} />
      ))}
    </Animated.View>
  );
}

const SHAKE_AMP = spacing.sm;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, justifyContent: 'center' },
  slot: {
    width: 32,
    height: 40,
    borderRadius: radii.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  flash: { borderRadius: radii.sm, borderWidth: 1 },
  dot: { width: 9, height: 9, borderRadius: 5 },
});
