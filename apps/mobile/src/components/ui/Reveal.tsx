import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

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
 * {@link delay}s for an orchestrated page-load stagger.
 *
 * On **native** this drives reanimated's `entering` layout animation — the fade
 * plays entirely on the UI thread with no JS-thread trigger, so content is never
 * invisible if the JS thread is busy at boot or back-navigation. On **web** it
 * drives {@link FadeView}'s CSS transition (web has no Hermes cold-start block).
 */
function NativeReveal({ delay = 0, duration = motion.slow, style, children }: RevealProps) {
  const reduced = useReducedMotion();
  if (reduced) {
    // Reduced-motion: render directly, no animation — matches StaggerList's behaviour.
    return <Animated.View style={style}>{children}</Animated.View>;
  }
  return (
    <Animated.View entering={FadeIn.delay(delay).duration(duration)} style={style}>
      {children}
    </Animated.View>
  );
}

function WebReveal({ delay = 0, duration = motion.slow, style, children }: RevealProps) {
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(true), []);
  return (
    <FadeView visible={shown} duration={duration} delay={delay} style={style}>
      {children}
    </FadeView>
  );
}

export const Reveal = Platform.OS === 'web' ? WebReveal : NativeReveal;
