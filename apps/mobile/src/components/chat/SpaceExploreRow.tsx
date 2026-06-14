import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { radii, spacing } from '@/theme';
import { plural } from '@drakkar.software/octochat-sdk';
import type { PublicSpaceEntry } from '@drakkar.software/octochat-sdk';
import { useHover } from '@/lib/use-hover';
import { useScalePress } from '@/lib/use-scale-press';
import { useTheme } from '@/lib/use-theme';
import { Avatar } from '@/components/ui/Avatar';
import { Pill } from '@/components/ui/Pill';
import { Txt } from '@/components/ui/Txt';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface SpaceExploreRowProps {
  /** The public space to list. */
  space: PublicSpaceEntry;
  /** Press handler — the directory is invite-only, so this typically surfaces the
   *  "joining needs an invite link" hint rather than navigating. When omitted the
   *  row is a static, non-interactive preview. */
  onPress?: () => void;
}

/** Two-letter monogram for a public space's avatar fallback. */
const monogram = (name: string | null) => (name ?? '').trim().slice(0, 2).toUpperCase() || 'PS';

/**
 * One space in the public-space directory (Explore screen): a lit-edge card with
 * a faint accent "light rail" — the marine motif reused as a shaft of light from
 * the deep — carrying the space's image/monogram, name and a channel-count meta
 * line, with an `INVITE-ONLY` tag. The directory grants no access (joining
 * needs the owner's invite link), so when an `onPress` is wired the row gives
 * honest hover/press feedback and surfaces that invite-only path rather than
 * navigating; without one it stays a static preview.
 */
export function SpaceExploreRow({ space, onPress }: SpaceExploreRowProps) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  const { animStyle, onPressIn, onPressOut } = useScalePress({ scaleTo: 0.985 });
  const surface = {
    backgroundColor: hovered ? colors.hover : colors.paperAlt,
    borderColor: hovered ? colors.accentBorder : colors.lineSoft,
    borderTopColor: colors.hairlineHi,
  };

  const body = (
    <>
      {/* A faint shaft of bioluminescent light down the leading edge. */}
      <View style={[styles.rail, { backgroundColor: colors.accentBorder }]} />
      <Avatar label={monogram(space.name)} image={space.image} size={42} />
      <View style={styles.body}>
        <Txt variant="subhead" weight="semibold" numberOfLines={1}>
          {space.name ?? 'Untitled space'}
        </Txt>
      </View>
      <View style={styles.tags}>
        {/* The directory is preview-only — a clear "invite-only" tag makes the
            lack of a join affordance read as deliberate, not broken. */}
        <Pill label="INVITE-ONLY" iconName="key" mono style={styles.tagPill} />
        <Pill label={plural(space.publicRooms, 'channel')} iconName="hash" mono style={styles.tagPill} />
      </View>
    </>
  );

  // Static preview when no handler is wired; otherwise a pressable that surfaces
  // the invite-only hint (with hover wash + a soft press spring for honest feedback).
  if (!onPress) {
    return <View style={[styles.row, surface]}>{body}</View>;
  }
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`${space.name ?? 'Untitled space'} — invite-only`}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      {...hoverProps}
      style={[styles.row, surface, animStyle]}
    >
      {body}
    </AnimatedPressable>
  );
}

/** Loading placeholder mirroring {@link SpaceExploreRow}'s frame — a few of these
 *  read as the directory surfacing, calmer than a bare spinner. */
export function SpaceExploreRowSkeleton() {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.paperAlt, borderColor: colors.lineFaint, borderTopColor: colors.hairlineHi },
      ]}
    >
      <View style={[styles.rail, { backgroundColor: colors.lineFaint }]} />
      <View style={[styles.skelAvatar, { backgroundColor: colors.fill }]} />
      <View style={styles.body}>
        <View style={[styles.skelBar, { backgroundColor: colors.fill, width: '62%' }]} />
        <View style={[styles.skelBar, { backgroundColor: colors.fillDeep, width: '38%', height: 9 }]} />
      </View>
      <View style={[styles.skelPill, { backgroundColor: colors.fill }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm + 2,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  rail: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    borderTopRightRadius: radii.xs,
    borderBottomRightRadius: radii.xs,
  },
  body: { flex: 1, gap: 3 },
  tags: { alignItems: 'flex-end', gap: 5 },
  tagPill: { alignSelf: 'flex-end' },
  // Skeleton primitives.
  skelAvatar: { width: 42, height: 42, borderRadius: radii.pill },
  skelBar: { height: 12, borderRadius: radii.xs },
  skelPill: { width: 56, height: 18, borderRadius: radii.pill },
});
