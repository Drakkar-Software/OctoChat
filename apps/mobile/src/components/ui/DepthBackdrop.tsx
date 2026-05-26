import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useTheme } from '@/lib/use-theme';

/**
 * The marine "subaqua depth" gradient — a top-lit wash that fades through the
 * canvas to a darker floor, giving any surface the sense of looking down through
 * water. The single source for that atmosphere: {@link Screen} (tabs/onboarding)
 * and {@link StackScreen} (the room/thread panes) both paint it, so the chat
 * surface reads with the same depth as the rest of the app rather than as flat
 * canvas. Absolutely filled, so it sits behind whatever content is layered over it.
 */
export function DepthBackdrop() {
  const { colors } = useTheme();
  return (
    <LinearGradient
      colors={[colors.depthTop, colors.canvas, colors.depthBottom]}
      locations={[0, 0.55, 1]}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    />
  );
}
