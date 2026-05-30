import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { radii } from '@/theme';
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

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? name}
      hitSlop={8}
      onPress={onPress}
      {...hoverProps}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={[styles.btn, { backgroundColor: hovered ? colors.hover : 'transparent' }, animStyle, style]}
    >
      <Icon name={name} size={size} color={color ?? colors.inkSoft} />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  btn: { padding: 6, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
});
