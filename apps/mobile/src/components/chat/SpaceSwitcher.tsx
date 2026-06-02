import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import type { Space } from '@/lib/types';
import { DM_HOME_NAME } from '@/lib/dm-home';
import { useHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface SpaceSwitcherProps {
  /** The active space — `undefined` when the virtual DM space is selected. */
  space?: Space;
  isDmHome?: boolean;
  spaces: Space[];
  activeId: string;
  /** Aggregate DM unread — feeds the attention dot when DMs are the unread source. */
  dmUnread?: number;
}

/**
 * Compact workspace identity that opens the full-screen space switcher on tap —
 * the lighter replacement for the always-on {@link SpaceRail}. The trigger shows
 * just the active space (avatar + name + chevron) with an aggregate dot when
 * *other* spaces/DMs are unread; tapping pushes the `/spaces` screen (a native
 * slide-in list with a filter field) rather than floating a dropdown, which read
 * poorly on mobile. Mobile-only (the desktop shell keeps its persistent rail).
 */
export function SpaceSwitcher({ space, isDmHome = false, spaces, activeId, dmUnread = 0 }: SpaceSwitcherProps) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();

  // A dot on the trigger when attention is owed somewhere OTHER than the active
  // space — the single pill can't show every space's badge like the rail did.
  const otherUnread =
    spaces.some((s) => s.id !== activeId && (s.unread ?? 0) > 0) || (!isDmHome && dmUnread > 0);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Switch space"
      onPress={() => router.push('/spaces')}
      {...hoverProps}
      style={[styles.trigger, { backgroundColor: hovered ? colors.hover : 'transparent' }]}
    >
      <View>
        {isDmHome ? (
          <View style={[styles.dmIcon, { backgroundColor: colors.accentBg, borderColor: colors.accentBorder }]}>
            <Icon name="people" size={16} color={colors.accent} />
          </View>
        ) : (
          <Avatar label={space?.short ?? '··'} image={space?.image} size={30} />
        )}
        {otherUnread ? <View style={[styles.dot, { backgroundColor: colors.unread, borderColor: colors.paper }]} /> : null}
      </View>
      <Txt variant="heading" weight="bold" numberOfLines={1} style={styles.name}>
        {isDmHome ? DM_HOME_NAME : space?.name ?? ' '}
      </Txt>
      <Icon name="chevron-down" size={16} color={colors.inkMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 4,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md,
  },
  dmIcon: { width: 30, height: 30, borderRadius: radii.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: -2, right: -2, width: 11, height: 11, borderRadius: 6, borderWidth: 2 },
  name: { flex: 1, minWidth: 0 },
});
