import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { fonts, motion, radii, shadows, spacing, type as typeScale } from '@/theme';
import { tapFeedback } from '@/lib/haptics';
import { useTheme, type Palette } from '@/lib/use-theme';

import { Icon, type IconName } from './Icon';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to fill the parent's width. */
  full?: boolean;
  /** Optional leading icon, auto-colored to match the label. */
  iconName?: IconName;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

const SIZES = {
  sm: { paddingVertical: 6, paddingHorizontal: 12, fontSize: typeScale.footnote.fontSize, gap: 6, minHeight: 32 },
  md: { paddingVertical: 10, paddingHorizontal: 16, fontSize: typeScale.body.fontSize, gap: 8, minHeight: 42 },
  lg: { paddingVertical: 13, paddingHorizontal: 20, fontSize: typeScale.subhead.fontSize, gap: 8, minHeight: spacing.controlMinHeight },
} as const;

function variantColors(c: Palette, variant: ButtonVariant) {
  switch (variant) {
    case 'primary':
      return { bg: c.accent, border: c.accent, fg: c.onAccent };
    case 'secondary':
      return { bg: c.paper, border: c.lineSoft, fg: c.ink };
    case 'ghost':
      return { bg: 'transparent', border: 'transparent', fg: c.inkSoft };
    case 'danger':
      return { bg: c.paper, border: c.dangerBorder, fg: c.danger };
  }
}

/** Generic pressable button — 4 variants × 3 sizes, with press spring + haptics. */
export function Button({
  label,
  onPress,
  variant = 'secondary',
  size = 'md',
  full = false,
  iconName,
  disabled = false,
  style,
}: ButtonProps) {
  const { colors } = useTheme();
  const v = variantColors(colors, variant);
  const s = SIZES[size];
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => {
        scale.value = withTiming(0.97, { duration: motion.fast });
        tapFeedback();
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: motion.fast });
      }}
      style={[
        styles.base,
        {
          backgroundColor: v.bg,
          borderColor: v.border,
          paddingVertical: s.paddingVertical,
          paddingHorizontal: s.paddingHorizontal,
          minHeight: s.minHeight,
          gap: s.gap,
          opacity: disabled ? 0.45 : 1,
          alignSelf: full ? 'stretch' : 'flex-start',
          width: full ? '100%' : undefined,
        },
        variant === 'primary' ? shadows.sm : null,
        animStyle,
        style,
      ]}
    >
      {iconName ? <Icon name={iconName} size={s.fontSize + 2} color={v.fg} /> : null}
      <Text style={[styles.label, { color: v.fg, fontSize: s.fontSize }]} numberOfLines={1}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radii.lg,
  },
  label: {
    fontFamily: fonts.bodySemibold,
    letterSpacing: 0.1,
    includeFontPadding: false,
  },
});
