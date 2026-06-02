import { type ReactNode, useEffect, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { motion } from '@/theme';

import { FadeView } from './FadeView';

interface RevealProps {
  /** Delay before the fade starts — stack increasing delays for a staggered reveal. */
  delay?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/**
 * Fades its children in once, on mount. Wrap a list of blocks with increasing
 * {@link delay}s for an orchestrated page-load stagger. Drives {@link FadeView},
 * so it animates off the JS thread on native and via CSS transition on web.
 */
export function Reveal({ delay = 0, duration = motion.slow, style, children }: RevealProps) {
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(true), []);
  return (
    <FadeView visible={shown} duration={duration} delay={delay} style={style}>
      {children}
    </FadeView>
  );
}
