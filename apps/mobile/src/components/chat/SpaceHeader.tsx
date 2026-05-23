import { Pressable, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import type { Space } from '@/lib/types';
import { useTheme } from '@/lib/use-theme';
import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';

import { SpaceMeta } from './SpaceMeta';
import { SpaceRail } from './SpaceRail';

interface SpaceHeaderProps {
  space: Space;
  spaces: Space[];
  activeId: string;
  /** Whether the active space is public (plaintext) vs private (E2EE). */
  isPublic: boolean;
  /** Owner + roster for private spaces; null for public (no roster). */
  memberCount?: number | null;
  onSelectSpace?: (id: string) => void;
  onAddSpace?: () => void;
  onSearch?: () => void;
  onMenu?: () => void;
  /** Tap the space title to open its info + settings screen. */
  onOpenSpace?: () => void;
}

/** Channel-list header: current space identity, actions, and the space rail. */
export function SpaceHeader({
  space,
  spaces,
  activeId,
  isPublic,
  memberCount,
  onSelectSpace,
  onAddSpace,
  onSearch,
  onMenu,
  onOpenSpace,
}: SpaceHeaderProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.header, { backgroundColor: colors.paper, borderBottomColor: colors.lineSoft }]}>
      <View style={styles.top}>
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
        <IconButton name="search" onPress={onSearch} accessibilityLabel="Search" />
        <IconButton name="dots" onPress={onMenu} accessibilityLabel="Space menu" />
      </View>
      <SpaceRail spaces={spaces} activeId={activeId} onSelect={onSelectSpace} onAdd={onAddSpace} />
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
});
