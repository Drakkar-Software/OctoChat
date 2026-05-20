import { StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import type { Space } from '@/lib/types';
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
}: SpaceHeaderProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.header, { backgroundColor: colors.paper, borderBottomColor: colors.lineSoft }]}>
      <View style={styles.top}>
        <View style={[styles.mono, { backgroundColor: colors.accent }]}>
          <Txt variant="footnote" weight="bold" mono color={colors.onAccent}>
            {space.short}
          </Txt>
        </View>
        <View style={styles.titleCol}>
          <Txt variant="subhead" weight="bold" numberOfLines={1}>
            {space.name}
          </Txt>
          <View style={styles.meta}>
            <Icon name="lock" size={10} color={colors.accent} />
            <Txt variant="micro" tone="inkMuted">
              {space.members} members · e2ee
            </Txt>
          </View>
        </View>
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
  mono: { width: 34, height: 34, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  titleCol: { flex: 1, minWidth: 0, gap: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
