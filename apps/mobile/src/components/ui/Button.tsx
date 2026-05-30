import type { StyleProp, ViewStyle } from 'react-native';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated from 'react-native-reanimated';

import { fonts, glowShadow, opacity, radii, shadows, spacing, type as typeScale } from '@/theme';
import { useHover } from '@/lib/use-hover';
import { useScalePress } from '@/lib/use-scale-press';
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
  /** Show a spinner in place of the leading icon and block presses — for async
   *  actions (e.g. generating an invite link) so the wait reads as "working". */
  loading?: boolean;
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
      return { bg: 'transparent', border: 'transparent', fg: c.onAccent };
    case 'secondary':
      return { bg: c.paper, border: c.lineSoft, fg: c.ink };
    case 'ghost':
      return { bg: 'transparent', border: 'transparent', fg: c.inkSoft };
    case 'danger':
      return { bg: c.paper, border: c.dangerBorder, fg: c.danger };
  }
}

/** Generic pressable button — 4 variants × 3 sizes, with press spring, web
 *  hover and (primary) a marine gradient + bioluminescent glow. */
export function Button({
  label,
  onPress,
  variant = 'secondary',
  size = 'md',
  full = false,
  iconName,
  disabled = false,
  loading = false,
  style,
}: ButtonProps) {
  const { colors } = useTheme();
  const v = variantColors(colors, variant);
  const s = SIZES[size];
  const { hovered, hoverProps } = useHover();
  const { animStyle, onPressIn, onPressOut } = useScalePress({ scaleTo: 0.97 });

  const isPrimary = variant === 'primary';
  const hoverWash = !hovered ? null : isPrimary ? colors.brightWash : colors.hover;

  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      {...hoverProps}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={[
        styles.base,
        {
          backgroundColor: v.bg,
          borderColor: v.border,
          paddingVertical: s.paddingVertical,
          paddingHorizontal: s.paddingHorizontal,
          minHeight: s.minHeight,
          gap: s.gap,
          opacity: disabled ? opacity.disabled : 1,
          alignSelf: full ? 'stretch' : 'flex-start',
          width: full ? '100%' : undefined,
        },
        isPrimary ? glowShadow(colors.glow, hovered ? 0.34 : 0.18, hovered ? 12 : 9) : variant === 'secondary' && hovered ? shadows.sm : null,
        animStyle,
        style,
      ]}
    >
      {isPrimary ? (
        <LinearGradient
          colors={[colors.accentGradTop, colors.accentGradBottom]}
          style={[StyleSheet.absoluteFill, styles.fill]}
        />
      ) : null}
      {hoverWash ? <View style={[StyleSheet.absoluteFill, styles.fill, { backgroundColor: hoverWash }]} /> : null}
      {loading ? (
        <ActivityIndicator size="small" color={v.fg} />
      ) : iconName ? (
        <Icon name={iconName} size={s.fontSize + 2} color={v.fg} />
      ) : null}
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
  fill: { borderRadius: radii.lg },
  label: {
    fontFamily: fonts.bodySemibold,
    letterSpacing: 0.1,
    includeFontPadding: false,
  },
});
