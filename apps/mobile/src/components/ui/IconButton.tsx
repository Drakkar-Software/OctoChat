import { useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Platform, Pressable, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { focusWidth, radii } from '@/theme';
import { useHover } from '@/lib/use-hover';
import { useScalePress } from '@/lib/use-scale-press';
import { useTheme } from '@/lib/use-theme';

import { Icon, type IconName } from './Icon';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface IconButtonProps {
  name: IconName;
  onPress?: () => void;
  size?: number;
  color?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Tappable icon with a press spring + haptics — header & toolbar actions. */
export function IconButton({ name, onPress, size = 20, color, accessibilityLabel, style }: IconButtonProps) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  const { animStyle, onPressIn, onPressOut } = useScalePress({ scaleTo: 0.86, fadeTo: 0.7 });
  const [focused, setFocused] = useState(false);

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? name}
      hitSlop={8}
      onPress={onPress}
      {...hoverProps}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.btn,
        { backgroundColor: hovered ? colors.hover : 'transparent' },
        // Web keyboard focus ring — accent outline just outside the pill target.
        Platform.OS === 'web' && focused
          ? ({ outlineWidth: focusWidth, outlineColor: colors.focusRing, outlineStyle: 'solid', outlineOffset: 1 } as StyleProp<ViewStyle>)
          : null,
        animStyle,
        style,
      ]}
    >
      <Icon name={name} size={size} color={color ?? colors.inkSoft} />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  btn: { padding: 6, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
});
