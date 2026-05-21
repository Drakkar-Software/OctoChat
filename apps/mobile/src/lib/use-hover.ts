import { useCallback, useState } from 'react';
import type { ViewProps } from 'react-native';
import { Platform } from 'react-native';

/**
 * Web pointer-hover state for `Pressable`-based controls. React Native Web
 * forwards `onHoverIn`/`onHoverOut`; native has no pointer, so this collapses
 * to a constant `false` there and the handlers no-op. Spread the handlers onto
 * a Pressable and drive a hover wash / scale from `hovered`.
 *
 *   const { hovered, hoverProps } = useHover();
 *   <Pressable {...hoverProps} style={[base, hovered && hoverStyle]} />
 */
export function useHover() {
  const [hovered, setHovered] = useState(false);
  const onHoverIn = useCallback(() => setHovered(true), []);
  const onHoverOut = useCallback(() => setHovered(false), []);

  const isWeb = Platform.OS === 'web';
  return {
    hovered: isWeb && hovered,
    hoverProps: isWeb ? { onHoverIn, onHoverOut } : {},
  };
}

/**
 * Hover state for a NON-pressable row. Drives `onMouseEnter`/`onMouseLeave`,
 * which React Native Web forwards on a plain `View` — so a row can reveal
 * controls on hover without becoming a `Pressable` (which adds a pointer cursor
 * and can interfere with text selection). No-ops on native (no pointer).
 *
 *   const { hovered, hoverProps } = useRowHover();
 *   <View {...hoverProps} style={[base, hovered && hoverStyle]} />
 */
export function useRowHover() {
  const [hovered, setHovered] = useState(false);
  const isWeb = Platform.OS === 'web';
  // `onMouseEnter`/`onMouseLeave` are web-only DOM handlers absent from RN's
  // ViewProps types; the cast lets us spread them onto a View on web.
  const hoverProps = (isWeb
    ? { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }
    : {}) as unknown as Partial<ViewProps>;
  return { hovered: isWeb && hovered, hoverProps };
}
