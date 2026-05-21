import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { layout, radii, spacing } from '@/theme';
import type { Room, Space } from '@/lib/types';
import type { RoomCategory } from '@/lib/use-rooms';
import { plural } from '@/lib/format';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

import { RoomCategorySection } from './RoomCategorySection';

interface DesktopRoomSidebarProps {
  space: Space;
  categories: RoomCategory[];
  activeRoomId?: string;
  onOpenRoom: (room: Room) => void;
  onJumpTo?: () => void;
  /** Open the space switcher / join surface (the header acts as a menu). */
  onOpenSpaceMenu?: () => void;
  loading?: boolean;
}

/**
 * The 240px channel sidebar of the desktop shell: a space header, a "jump to"
 * search affordance, and the space's rooms grouped by category. Reuses
 * {@link RoomCategorySection}/{@link ChannelRow} so list rows stay identical
 * to the mobile rooms tab.
 */
export function DesktopRoomSidebar({
  space,
  categories,
  activeRoomId,
  onOpenRoom,
  onJumpTo,
  onOpenSpaceMenu,
  loading = false,
}: DesktopRoomSidebarProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.sidebar, { width: layout.sidebarWidth, backgroundColor: colors.paperAlt, borderRightColor: colors.lineSoft }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Space menu"
        onPress={onOpenSpaceMenu}
        style={[styles.header, { borderBottomColor: colors.lineFaint }]}
      >
        <View style={styles.headerText}>
          <Txt variant="subhead" weight="semibold" numberOfLines={1}>
            {space.name}
          </Txt>
          <View style={styles.meta}>
            <Icon name="lock" size={9} color={colors.accent} />
            <Txt variant="micro" tone="inkMuted" numberOfLines={1}>
              end-to-end encrypted · {plural(space.members, 'member')}
            </Txt>
          </View>
        </View>
        <Icon name="chevron-down" size={13} color={colors.inkMuted} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Jump to a room"
        onPress={onJumpTo}
        style={[styles.jump, { backgroundColor: colors.fill, borderColor: colors.lineFaint }]}
      >
        <Icon name="search" size={12} color={colors.inkMuted} />
        <Txt variant="footnote" tone="inkMuted" style={styles.jumpLabel}>
          Jump to…
        </Txt>
        {Platform.OS === 'web' ? (
          <Txt variant="micro" mono tone="inkMuted">
            ⌘K
          </Txt>
        ) : null}
      </Pressable>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {loading ? (
          <Txt variant="footnote" tone="inkMuted" style={styles.empty}>
            Loading rooms…
          </Txt>
        ) : categories.length === 0 ? (
          <Txt variant="footnote" tone="inkMuted" style={styles.empty}>
            No rooms yet.
          </Txt>
        ) : (
          categories.map((cat) => (
            <RoomCategorySection key={cat.name} category={cat} activeRoomId={activeRoomId} onOpenRoom={onOpenRoom} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: { borderRightWidth: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
  },
  headerText: { flex: 1, minWidth: 0, gap: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  jump: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 30,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  jumpLabel: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  empty: { padding: spacing.md },
});
