import { Children, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { motion } from '@/theme';

import { Reveal } from './Reveal';

interface StaggerListProps {
  children: ReactNode;
  /** Head delay before the first child reveals. */
  base?: number;
  /** Per-index delay added to each successive child. */
  step?: number;
  /** Cap the number of staggered items — beyond this they all share the cap delay
   *  so a long list doesn't trail off into a slow cascade (and virtualized rows
   *  must never be wrapped individually). */
  cap?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Orchestrated page-load entrance: reveals its children in sequence with an
 * increasing delay (the app's one "surfacing from the deep" stagger). Drives
 * {@link Reveal}, so it animates off the JS thread on native / via CSS on web and
 * fires **once on mount** — re-key the StaggerList (e.g. `key={spaceId}`) to replay
 * it on a context switch. Under reduced motion it renders children instantly with
 * no stagger.
 */
export function StaggerList({
  children,
  base = motion.stagger.base,
  step = motion.stagger.step,
  cap = 8,
  duration,
  style,
}: StaggerListProps) {
  const reduced = useReducedMotion();
  const items = Children.toArray(children);

  if (reduced) return <View style={style}>{items}</View>;

  return (
    <View style={style}>
      {items.map((child, i) => (
        <Reveal key={i} delay={base + Math.min(i, cap) * step} duration={duration}>
          {child}
        </Reveal>
      ))}
    </View>
  );
}
