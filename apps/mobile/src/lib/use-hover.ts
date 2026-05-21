import { useCallback, useState } from 'react';
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
