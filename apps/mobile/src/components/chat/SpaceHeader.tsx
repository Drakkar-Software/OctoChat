import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import type { Space } from '@/lib/types';
import { DM_HOME_NAME } from '@/lib/dm-home';
import { useTheme } from '@/lib/use-theme';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';

import { SpaceMeta } from './SpaceMeta';
import { SpaceRail } from './SpaceRail';

interface SpaceHeaderProps {
  /** The active space — `undefined` when the virtual DM space is selected. */
  space?: Space;
  /** True when the virtual DM space is selected (no real space). */
  isDmHome?: boolean;
  spaces: Space[];
  activeId: string;
  /** Whether the active space is public (plaintext) vs private (E2EE). */
  isPublic: boolean;
  /** Owner + roster for private spaces; null for public (no roster). */
  memberCount?: number | null;
  onSelectSpace?: (id: string) => void;
  /** Select the virtual DM space. */
  onSelectDms?: () => void;
  dmsActive?: boolean;
  dmUnread?: number;
  onAddSpace?: () => void;
  onSearch?: () => void;
  onMenu?: () => void;
  /** Tap the space title to open its info + settings screen. */
  onOpenSpace?: () => void;
}

/** Channel-list header: current space identity, actions, and the space rail. */
export function SpaceHeader({
  space,
  isDmHome,
  spaces,
  activeId,
  isPublic,
  memberCount,
  onSelectSpace,
  onSelectDms,
  dmsActive,
  dmUnread,
  onAddSpace,
  onSearch,
  onMenu,
  onOpenSpace,
}: SpaceHeaderProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.header, { backgroundColor: colors.paper, borderBottomColor: colors.lineSoft }]}>
      <View style={styles.top}>
        {isDmHome ? (
          // The virtual DM space has no settings screen — a non-pressable identity.
          <View style={styles.titleRow}>
            <View style={[styles.dmIcon, { backgroundColor: colors.accentBg, borderColor: colors.accentBorder }]}>
              <Icon name="people" size={18} color={colors.accent} />
            </View>
            <View style={styles.titleCol}>
              <Txt variant="heading" weight="bold" numberOfLines={1}>
                {DM_HOME_NAME}
              </Txt>
            </View>
          </View>
        ) : space ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Space info and settings"
            onPress={onOpenSpace}
            style={styles.titleRow}
          >
            <Avatar label={space.short} image={space.image} size={34} />
            <View style={styles.titleCol}>
              <Txt variant="heading" weight="bold" numberOfLines={1}>
                {space.name}
              </Txt>
              <SpaceMeta isPublic={isPublic} memberCount={memberCount} iconSize={10} />
            </View>
          </Pressable>
        ) : (
          <View style={styles.titleRow} />
        )}
        <IconButton name="search" onPress={onSearch} accessibilityLabel="Search" />
        <IconButton name="plus" onPress={onMenu} accessibilityLabel="Join or create a space" />
      </View>
      <SpaceRail
        spaces={spaces}
        activeId={activeId}
        onSelect={onSelectSpace}
        onAdd={onAddSpace}
        onSelectDms={onSelectDms}
        dmsActive={dmsActive}
        dmUnread={dmUnread}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    gap: spacing.md,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  titleRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  titleCol: { flex: 1, minWidth: 0, gap: 2 },
  // Matches the Avatar size={34} footprint so the DM-home header height is identical.
  dmIcon: { width: 34, height: 34, borderRadius: radii.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
