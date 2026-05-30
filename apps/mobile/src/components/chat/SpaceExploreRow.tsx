import { StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { plural } from '@/lib/format';
import type { PublicSpaceEntry } from '@/lib/explore-spaces';
import { useTheme } from '@/lib/use-theme';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
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
 * One row in the public-space directory (Explore screen): the space's
 * image/monogram, its name, and a meta line (owner · channel count). A faint
 * globe marks it public. View-only — there's no join affordance here because the
 * directory entry grants no access; joining still needs the owner's invite link
 * (the Explore screen states this once, below the list).
 */
export function SpaceExploreRow({ space, ownerName }: SpaceExploreRowProps) {
  const { colors } = useTheme();
  const owner = ownerName ?? shortOwner(space.ownerId);
  return (
    <View style={[styles.row, { backgroundColor: colors.paperAlt, borderColor: colors.lineSoft, borderTopColor: colors.hairlineHi }]}>
      <Avatar label={monogram(space.name)} image={space.image} size={40} />
      <View style={styles.body}>
        <Txt variant="subhead" weight="semibold" numberOfLines={1}>
          {space.name ?? 'Untitled space'}
        </Txt>
        <Txt variant="caption" tone="inkMuted" numberOfLines={1}>
          {owner} · {plural(space.rooms, 'channel')}
        </Txt>
      </View>
      <Icon name="globe" size={16} color={colors.inkMuted} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  body: { flex: 1, gap: 2 },
});
