import { Pressable, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import type { Space } from '@/lib/types';
import { plural } from '@/lib/format';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';

import { SpaceRail } from './SpaceRail';

interface SpaceHeaderProps {
  space: Space;
  spaces: Space[];
  activeId: string;
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
          style={styles.titleCol}
        >
          <Txt variant="heading" weight="bold" numberOfLines={1}>
            {space.name}
          </Txt>
          <View style={styles.meta}>
            <Icon name="lock" size={10} color={colors.accent} />
            <Txt variant="micro" tone="inkMuted">
              {plural(space.members, 'member')} · e2ee
            </Txt>
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
  titleCol: { flex: 1, minWidth: 0, gap: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
