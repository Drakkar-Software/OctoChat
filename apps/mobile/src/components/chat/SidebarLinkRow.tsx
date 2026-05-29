import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';
import { Badge } from '@/components/ui/Badge';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface SidebarLinkRowProps {
  iconName: IconName;
  label: string;
  active?: boolean;
  /** Optional unread count badge on the right. */
  unread?: number;
  /** Optional `@` mention marker (overrides `unread`). */
  mention?: boolean;
  onPress?: () => void;
}

/**
 * A destination row in the desktop room sidebar — used for non-room targets
 * (Threads, future Mentions/Drafts). Mirrors {@link ChannelRow}'s hover/active
 * visual (left accent rail + accent wash) so the sidebar reads as one cohesive
 * list of destinations, regardless of whether a row points at a room or a view.
 */
export function SidebarLinkRow({ iconName, label, active = false, unread, mention, onPress }: SidebarLinkRowProps) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  const emphasized = (unread ?? 0) > 0 || !!mention;
  const labelColor = active ? colors.accentInk : emphasized ? colors.ink : colors.inkSoft;
  const bg = active
    ? hovered
      ? colors.accentSoftHover
      : colors.accentSoft
    : hovered
      ? colors.hover
      : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      {...hoverProps}
      style={[styles.row, { backgroundColor: bg }]}
    >
      {active ? <View style={[styles.rail, { backgroundColor: colors.accent }]} /> : null}
      <Icon name={iconName} size={15} color={active ? colors.accent : emphasized ? colors.ink : colors.inkMuted} />
      <Txt
        variant="subhead"
        weight={emphasized || active ? 'semibold' : 'regular'}
        color={labelColor}
        numberOfLines={1}
        style={styles.name}
      >
        {label}
      </Txt>
      {mention ? <Badge mention /> : unread ? <Badge count={unread} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
  },
  rail: {
    position: 'absolute',
    left: 0,
    top: 7,
    bottom: 7,
    width: 3,
    borderTopRightRadius: radii.xs,
    borderBottomRightRadius: radii.xs,
  },
  name: { flex: 1 },
});
