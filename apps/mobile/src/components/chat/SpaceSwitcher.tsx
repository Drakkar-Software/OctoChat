import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radii, spacing } from '@/theme';
import type { Space } from '@/lib/types';
import { DM_HOME_NAME } from '@/lib/dm-home';
import { useHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

import { ListRow } from './ListRow';

interface SpaceSwitcherProps {
  /** The active space — `undefined` when the virtual DM space is selected. */
  space?: Space;
  isDmHome?: boolean;
  spaces: Space[];
  activeId: string;
  /** Aggregate DM unread, badged on the DM-home row. */
  dmUnread?: number;
  onSelectSpace?: (id: string) => void;
  onSelectDms?: () => void;
  onAddSpace?: () => void;
}

/**
 * Compact workspace identity that opens the space list on tap — the lighter
 * replacement for the always-on {@link SpaceRail}. The trigger shows just the
 * active space (avatar + name + chevron) with an aggregate dot when *other*
 * spaces/DMs are unread; tapping floats a dropdown of every space, the DM home
 * and a join entry. Mobile-only (the desktop shell keeps its persistent rail).
 */
export function SpaceSwitcher({
  space,
  isDmHome = false,
  spaces,
  activeId,
  dmUnread = 0,
  onSelectSpace,
  onSelectDms,
  onAddSpace,
}: SpaceSwitcherProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { hovered, hoverProps } = useHover();
  const [open, setOpen] = useState(false);

  // A dot on the trigger when attention is owed somewhere OTHER than the active
  // space — the single pill can't show every space's badge like the rail did.
  const otherUnread =
    spaces.some((s) => s.id !== activeId && (s.unread ?? 0) > 0) || (!isDmHome && dmUnread > 0);

  const select = (fn?: () => void) => {
    fn?.();
    setOpen(false);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Switch space"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        {...hoverProps}
        style={[styles.trigger, { backgroundColor: hovered || open ? colors.hover : 'transparent' }]}
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

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close space switcher">
          <Pressable style={[styles.anchor, { marginTop: insets.top + spacing.sm }]} onPress={() => {}}>
            <Card style={styles.card}>
              <Txt variant="micro" weight="semibold" mono uppercase tone="inkMuted" style={styles.heading}>
                Spaces
              </Txt>
              <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
                <ListRow
                  iconName="people"
                  label={DM_HOME_NAME}
                  active={isDmHome}
                  unread={dmUnread}
                  onPress={() => select(onSelectDms)}
                />
                {spaces.map((s) => (
                  <ListRow
                    key={s.id}
                    avatarLabel={s.short}
                    avatarImage={s.image}
                    label={s.name}
                    active={!isDmHome && s.id === activeId}
                    unread={s.unread}
                    onPress={() => select(() => onSelectSpace?.(s.id))}
                  />
                ))}
                <View style={[styles.divider, { backgroundColor: colors.lineFaint }]} />
                <ListRow iconName="plus" label="Join or create a space" onPress={() => select(onAddSpace)} />
              </ScrollView>
            </Card>
          </Pressable>
        </Pressable>
      </Modal>
    </>
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
  backdrop: { flex: 1 },
  anchor: { marginHorizontal: spacing.sm },
  card: { padding: spacing.xs, maxHeight: 420 },
  heading: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs, letterSpacing: 0.6 },
  list: { flexGrow: 0 },
  divider: { height: 1, marginVertical: spacing.xs, marginHorizontal: spacing.sm },
});
