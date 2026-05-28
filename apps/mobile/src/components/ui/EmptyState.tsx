import { type ReactNode, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { glowShadow, motion, radii, spacing } from '@/theme';
import { tapFeedback } from '@/lib/haptics';
import { useHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';

import { Icon, type IconName } from './Icon';
import { PulseHalo } from './PulseHalo';
import { Txt } from './Txt';

interface EmptyStateProps {
  iconName: IconName;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  /** Make the centered icon disc pressable — lets the sign-in prompt's lock itself
   *  trigger a passkey unlock. Whenever `iconName` changes (e.g. lock → unlock) the
   *  disc runs a one-shot scale-pop, reading as the lock springing open. */
  onIconPress?: () => void;
}

/** Centered icon + copy used for empty tabs and the not-found screen. The icon
 *  disc sits inside a slow bioluminescent halo so empty space feels alive. */
export function EmptyState({ iconName, title, subtitle, children, onIconPress }: EmptyStateProps) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  const pop = useSharedValue(1);
  const press = useSharedValue(1);
  // Skip the pop on first mount: only a *change* of glyph (lock → unlock) should
  // spring, not the disc's initial appearance.
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    pop.value = withSequence(withTiming(1.22, { duration: motion.fast }), withTiming(1, { duration: motion.base }));
  }, [iconName, pop]);

  const discStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value * press.value }] }));

  const disc = (
    <Animated.View
      style={[
        styles.icon,
        { backgroundColor: colors.accentBg, borderColor: colors.accentBorder, borderTopColor: colors.hairlineHi },
        glowShadow(colors.glow, hovered ? 0.34 : 0.2, hovered ? 18 : 14),
        // Android renders the elevation shadow of this fully-rounded disc as a
        // hexagon (its rounded-rect outline shadow degrades to a polygon at
        // radius 999). Web (boxShadow) and iOS (shadow* props) draw a clean
        // bloom and ignore `elevation`, so zeroing it only strips Android's artifact.
        { elevation: 0 },
        discStyle,
      ]}
    >
      <Icon name={iconName} size={28} color={colors.accent} />
    </Animated.View>
  );

  return (
    <View style={styles.wrap}>
      <PulseHalo size={76} color={colors.accent}>
        {onIconPress ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={title}
            {...hoverProps}
            onPress={onIconPress}
            onPressIn={() => {
              press.value = withTiming(0.92, { duration: motion.fast });
              tapFeedback();
            }}
            onPressOut={() => {
              press.value = withTiming(1, { duration: motion.fast });
            }}
          >
            {disc}
          </Pressable>
        ) : (
          disc
        )}
      </PulseHalo>
      <Txt variant="title" weight="bold" center style={styles.title}>
        {title}
      </Txt>
      {subtitle ? (
        <Txt variant="callout" tone="inkSoft" center style={styles.subtitle}>
          {subtitle}
        </Txt>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  icon: {
    width: 76,
    height: 76,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Clear the halo's bloom (rings expand to ~1.85×) so the pulse doesn't ride up
  // onto the title — the `wrap` gap alone leaves it overlapping at full bloom.
  title: { marginTop: spacing.sm },
  subtitle: { maxWidth: 320 },
});
