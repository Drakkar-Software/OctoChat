import { Pressable, StyleSheet } from 'react-native';

import { glowShadow, radii, spacing } from '@/theme';
import { useHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';
import { Txt } from '@/components/ui/Txt';

interface ChoicePillProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

/**
 * A single tappable segmented choice — the shared control behind the cadence,
 * calendar-mode, weekday and cron-example pill rows. Built on the same hover /
 * accentSoft treatment as {@link ModeSwitcher}'s segment: an idle pill picks up
 * `hover`, a selected pill picks up `accentSoftHover` on hover and a faint
 * bioluminescent `glowShadow` so the current choice reads as chosen, not merely
 * filled. A `controlMinHeight` floor (with the wrapped-row padding) keeps the tap
 * target comfortable where the bare 6px-pad pills missed it. Pure composition over
 * `Pressable` + `Txt` + theme tokens.
 */
export function ChoicePill({ label, active, onPress }: ChoicePillProps) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();

  const bg = active ? (hovered ? colors.accentSoftHover : colors.accentSoft) : hovered ? colors.hover : 'transparent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      {...hoverProps}
      // hitSlop lifts the effective tap target to the controlMinHeight floor on the
      // wrapped rows where the visible pill packs tighter than 48px.
      hitSlop={spacing.xs}
      style={[
        styles.pill,
        { backgroundColor: bg },
        // Android renders the elevation of this small rounded pill as a faint grey rect;
        // web (boxShadow) + iOS draw the bloom and ignore elevation, so zeroing it only
        // strips Android's artifact (same trick as EmptyState's disc).
        active ? [glowShadow(colors.glow, 0.18, 10), styles.noElevation] : null,
      ]}
    >
      <Txt
        variant="caption"
        weight={active ? 'semibold' : 'regular'}
        color={active ? colors.accentInk : colors.inkMuted}
        numberOfLines={1}
      >
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 34,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noElevation: { elevation: 0 },
});
