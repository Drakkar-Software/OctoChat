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

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonShape = 'rounded' | 'pill';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Corner treatment — `rounded` (default, radii.lg) or a fully-rounded `pill`. */
  shape?: ButtonShape;
  /** Stretch to fill the parent's width. */
  full?: boolean;
  /** Optional leading icon, auto-colored to match the label. */
  iconName?: IconName;
  /** Render the icon alone (square target, `label` becomes the a11y label).
   *  Requires `iconName`. */
  iconOnly?: boolean;
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
    case 'accent':
      return { bg: 'transparent', border: 'transparent', fg: c.accentInk };
  }
}

/** Generic pressable button — 4 variants × 3 sizes, with press spring, web
 *  hover and (primary) a marine gradient + bioluminescent glow. */
export function Button({
  label,
  onPress,
  variant = 'secondary',
  size = 'md',
  shape = 'rounded',
  full = false,
  iconName,
  iconOnly = false,
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
  const isPill = shape === 'pill';
  const radius = isPill ? radii.pill : radii.lg;
  // `accent` is a low-emphasis text action — it hovers with the accent wash, not
  // the primary's bright gradient overlay.
  const hoverWash = !hovered ? null : isPrimary ? colors.brightWash : variant === 'accent' ? colors.accentBg : colors.hover;
  // Icon-only collapses to a square target: drop the gap + horizontal padding
  // so the glyph sits centered in a minHeight×minHeight tap area.
  const square = iconOnly && !!iconName;

  return (
    // Opacity and layout sit on a plain View so animStyle (which always emits
    // opacity:1 at rest) cannot override the disabled dim on the inner Pressable.
    <View
      style={[
        {
          opacity: disabled ? opacity.disabled : 1,
          alignSelf: full ? 'stretch' : 'flex-start',
          width: full ? '100%' : undefined,
        },
        style,
      ]}
    >
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={square ? label : undefined}
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
          borderRadius: radius,
          paddingVertical: s.paddingVertical,
          paddingHorizontal: square ? 0 : s.paddingHorizontal,
          minHeight: s.minHeight,
          minWidth: square ? s.minHeight : undefined,
          gap: square ? 0 : s.gap,
        },
        isPrimary ? glowShadow(colors.glow, hovered ? 0.34 : 0.18, hovered ? 12 : 9) : variant === 'secondary' && hovered ? shadows.sm : null,
        animStyle,
      ]}
    >
      {isPrimary ? (
        <LinearGradient
          colors={[colors.accentGradTop, colors.accentGradBottom]}
          style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
        />
      ) : null}
      {hoverWash ? <View style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: hoverWash }]} /> : null}
      {loading ? (
        <ActivityIndicator size="small" color={v.fg} />
      ) : iconName ? (
        <Icon name={iconName} size={s.fontSize + 2} color={v.fg} />
      ) : null}
      {square ? null : (
        <Text style={[styles.label, { color: v.fg, fontSize: s.fontSize }]} numberOfLines={1}>
          {label}
        </Text>
      )}
    </AnimatedPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  label: {
    fontFamily: fonts.bodySemibold,
    letterSpacing: 0.1,
    includeFontPadding: false,
  },
});
