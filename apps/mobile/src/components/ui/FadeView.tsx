import { useEffect } from 'react';
import { Platform, View, type ViewProps, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

interface FadeViewProps extends ViewProps {
  /** Target visibility; opacity animates to 1 when true, 0 when false. */
  visible: boolean;
  /** Fade duration in ms. Pass per-direction (e.g. `visible ? fast : slow`) for asymmetric timing. */
  duration: number;
  /** Delay before the fade starts, in ms. */
  delay?: number;
}

/**
 * Opacity fade driven on the compositor on web, on the UI thread on native — so
 * it keeps animating even when the JS thread is blocked (e.g. the multi-second
 * Argon2id PIN-stretch). react-native-web maps the `transition*` style props to
 * real CSS transitions; reanimated runs its worklet off-thread on native.
 */
function WebFadeView({ visible, duration, delay = 0, style, ...rest }: FadeViewProps) {
  // RN's ViewStyle type omits the web-only transition props that RNW reads.
  const transition = {
    opacity: visible ? 1 : 0,
    transitionProperty: 'opacity',
    transitionDuration: `${duration}ms`,
    transitionDelay: `${delay}ms`,
    transitionTimingFunction: 'ease',
  } as unknown as ViewStyle;
  return <View {...rest} style={[style, transition]} />;
}

function NativeFadeView({ visible, duration, delay = 0, style, ...rest }: FadeViewProps) {
  const opacity = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(visible ? 1 : 0, { duration }));
  }, [visible, duration, delay, opacity]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View {...rest} style={[style, animatedStyle]} />;
}

export const FadeView = Platform.OS === 'web' ? WebFadeView : NativeFadeView;
