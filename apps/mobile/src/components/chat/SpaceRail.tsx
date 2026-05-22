import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import type { Space } from '@/lib/types';
import { useTheme } from '@/lib/use-theme';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface SpaceRailProps {
  spaces: Space[];
  activeId: string;
  onSelect?: (id: string) => void;
  onAdd?: () => void;
}

function RailItem({
  label,
  active,
  unread,
  locked,
  onPress,
}: {
  label: string;
  active: boolean;
  unread?: number;
  locked?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.itemWrap}>
      <View
        style={[
          styles.tile,
          {
            borderRadius: active ? radii.md : radii.lg,
            backgroundColor: active ? colors.accent : colors.fill,
            borderColor: active ? 'transparent' : colors.lineFaint,
            borderWidth: active ? 0 : 1,
          },
        ]}
      >
        <Txt variant="caption" weight="bold" mono color={active ? colors.onAccent : colors.inkSoft}>
          {label}
        </Txt>
      </View>
      {locked ? (
        <View style={[styles.lock, { backgroundColor: colors.paper, borderColor: colors.lineSoft }]}>
          <Icon name="lock" size={8} color={colors.inkMuted} />
        </View>
      ) : null}
      {unread ? (
        <View style={styles.badge}>
          <Badge count={unread} />
        </View>
      ) : null}
    </Pressable>
  );
}

/** Horizontal rail of space monograms with per-space unread badges. */
export function SpaceRail({ spaces, activeId, onSelect, onAdd }: SpaceRailProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.rail}>
      {spaces.map((s) => (
        <RailItem
          key={s.id}
          label={s.short}
          active={s.id === activeId}
          unread={s.unread}
          locked={(s.type ?? 'private') === 'private'}
          onPress={() => onSelect?.(s.id)}
        />
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create or join a space"
        onPress={onAdd}
        style={[styles.tile, styles.add, { borderColor: colors.lineSoft }]}
      >
        <Icon name="plus" size={16} color={colors.inkMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  itemWrap: { position: 'relative' },
  tile: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  add: { borderRadius: radii.lg, borderWidth: 1, borderStyle: 'dashed' },
  badge: { position: 'absolute', top: -5, right: -5 },
  lock: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
