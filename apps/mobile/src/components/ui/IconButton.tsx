import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { motion } from '@/theme';
import { tapFeedback } from '@/lib/haptics';
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
  const pressed = useSharedValue(0);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.14 }],
    opacity: 1 - pressed.value * 0.3,
  }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? name}
      hitSlop={8}
      onPress={onPress}
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: motion.fast });
        tapFeedback();
      }}
      onPressOut={() => {
        pressed.value = withTiming(0, { duration: motion.fast });
      }}
      style={[styles.btn, animStyle, style]}
    >
      <Icon name={name} size={size} color={color ?? colors.inkSoft} />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  btn: { padding: 4, alignItems: 'center', justifyContent: 'center' },
});
