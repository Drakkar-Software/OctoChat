import { Pressable, StyleSheet, View } from 'react-native';

import { layout, radii, spacing } from '@/theme';
import type { Space } from '@/lib/types';
import { useTheme } from '@/lib/use-theme';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Octopus } from '@/components/brand/Octopus';
import { Txt } from '@/components/ui/Txt';

interface DesktopSpacesRailProps {
  spaces: Space[];
  activeId: string | null;
  onSelect?: (id: string) => void;
  onAdd?: () => void;
  /** Bottom avatar / gear → the current identity's profile. */
  meLabel: string;
  onOpenProfile?: () => void;
}

function SpaceTile({
  label,
  active,
  unread,
  onPress,
}: {
  label: string;
  active: boolean;
  unread?: number;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.tileWrap}>
      <View
        style={[
          styles.tile,
          {
            borderRadius: active ? radii.lg : radii.xl,
            backgroundColor: active ? colors.accent : colors.fill,
            borderColor: active ? 'transparent' : colors.lineFaint,
            borderWidth: active ? 0 : 1,
          },
        ]}
      >
        <Txt variant="footnote" weight="bold" mono color={active ? colors.onAccent : colors.inkSoft}>
          {label}
        </Txt>
      </View>
      {unread ? (
        <View style={styles.badge}>
          <Badge count={unread} />
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Vertical spaces rail pinned to the left edge of the desktop shell: the brand
 * mark, one monogram tile per space (active tile squares off, others stay
 * rounded), an add button, then the current identity at the foot.
 */
export function DesktopSpacesRail({
  spaces,
  activeId,
  onSelect,
  onAdd,
  meLabel,
  onOpenProfile,
}: DesktopSpacesRailProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.rail, { width: layout.railWidth, backgroundColor: colors.paperAlt, borderRightColor: colors.lineSoft }]}>
      <Octopus size={28} />
      <View style={[styles.rule, { backgroundColor: colors.lineFaint }]} />
      {spaces.map((s) => (
        <SpaceTile
          key={s.id}
          label={s.short}
          active={s.id === activeId}
          unread={s.unread}
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
      <View style={styles.spacer} />
      <Pressable accessibilityRole="button" accessibilityLabel="Your profile" onPress={onOpenProfile} style={styles.foot}>
        <Avatar label={meLabel} size={32} />
        <Icon name="gear" size={16} color={colors.inkMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    paddingVertical: spacing.md,
    borderRightWidth: 1,
    alignItems: 'center',
    gap: spacing.sm,
  },
  rule: { width: 28, height: 1, marginVertical: spacing.xs },
  tileWrap: { position: 'relative' },
  tile: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  add: { borderRadius: radii.xl, borderWidth: 1, borderStyle: 'dashed' },
  badge: { position: 'absolute', top: -5, right: -5 },
  spacer: { flex: 1 },
  foot: { alignItems: 'center', gap: spacing.sm },
});
