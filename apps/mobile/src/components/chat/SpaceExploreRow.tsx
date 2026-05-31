import { StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { plural } from '@/lib/format';
import type { PublicSpaceEntry } from '@/lib/explore-spaces';
import { useTheme } from '@/lib/use-theme';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { Txt } from '@/components/ui/Txt';

interface SpaceExploreRowProps {
  /** The public space to list. */
  space: PublicSpaceEntry;
  /** The owner's resolved display pseudo, if known (falls back to a short id). */
  ownerName?: string;
}

/** Two-letter monogram for a public space's avatar fallback (matches pubspace.ts). */
const monogram = (name: string | null) => (name ?? '').trim().slice(0, 2).toUpperCase() || 'PS';

/** Short, human-ish owner label when no pseudo is set yet (account ids are 64-hex). */
const shortOwner = (id: string | null) => (id ? `user-${id.slice(0, 6)}` : 'unknown');

/**
 * One space in the public-space directory (Explore screen): a lit-edge card with
 * a faint accent "light rail" — the marine motif reused as a shaft of light from
 * the deep — carrying the space's image/monogram, name and an owner · channel-count
 * meta line, with a `PUBLIC` tag. View-only: there's no join affordance because the
 * directory entry grants no access (joining needs the owner's invite link, stated
 * once on the screen).
 */
export function SpaceExploreRow({ space, ownerName }: SpaceExploreRowProps) {
  const { colors } = useTheme();
  const owner = ownerName ?? shortOwner(space.ownerId);
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.paperAlt, borderColor: colors.lineSoft, borderTopColor: colors.hairlineHi },
      ]}
    >
      {/* A faint shaft of bioluminescent light down the leading edge. */}
      <View style={[styles.rail, { backgroundColor: colors.accentBorder }]} />
      <Avatar label={monogram(space.name)} image={space.image} size={42} />
      <View style={styles.body}>
        <Txt variant="subhead" weight="semibold" numberOfLines={1}>
          {space.name ?? 'Untitled space'}
        </Txt>
        <View style={styles.meta}>
          <Icon name="people" size={12} color={colors.inkMuted} />
          <Txt variant="caption" tone="inkMuted" numberOfLines={1} style={styles.owner}>
            {owner}
          </Txt>
        </View>
      </View>
      <View style={styles.tags}>
        <Pill label="PUBLIC" tone="accent" iconName="globe" style={styles.tagPill} />
        <Pill label={plural(space.rooms, 'channel')} iconName="hash" mono style={styles.tagPill} />
      </View>
    </View>
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
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  owner: { flex: 1 },
  tags: { alignItems: 'flex-end', gap: 5 },
  tagPill: { alignSelf: 'flex-end' },
  // Skeleton primitives.
  skelAvatar: { width: 42, height: 42, borderRadius: radii.pill },
  skelBar: { height: 12, borderRadius: radii.xs },
  skelPill: { width: 56, height: 18, borderRadius: radii.pill },
});
