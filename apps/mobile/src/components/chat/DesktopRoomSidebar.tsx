import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { layout, radii, spacing } from '@/theme';
import type { Room, RoomKind, Space } from '@/lib/types';
import type { ThreadSummary } from '@/lib/threads';
import type { RoomCategory } from '@/lib/use-rooms';
import { useHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

import { ChannelListSkeleton } from './ChannelListSkeleton';
import { RoomCategorySection } from './RoomCategorySection';
import { SidebarLinkRow } from './SidebarLinkRow';
import { SpaceMeta } from './SpaceMeta';

interface DesktopRoomSidebarProps {
  space: Space;
  /** Whether the active space is public (plaintext) vs private (E2EE). */
  isPublic: boolean;
  /** Owner + roster for private spaces; null for public (no roster). */
  memberCount?: number | null;
  categories: RoomCategory[];
  activeRoomId?: string;
  /** Recent threads of the active room, listed under its row. Omit to show none. */
  threads?: ThreadSummary[];
  onOpenRoom: (room: Room) => void;
  /** Open one of the active room's threads (the reply target's message id). */
  onOpenThread?: (parentId: string) => void;
  /** Open the Threads view (every thread in the active space). */
  onOpenThreads?: () => void;
  /** Highlight the Threads row as the current destination. */
  threadsActive?: boolean;
  onJumpTo?: () => void;
  /** Open the space switcher / join surface (the header acts as a menu). */
  onOpenSpaceMenu?: () => void;
  /** Create a room in a category. `kind` is `'channel'` or `'stream'` (append-only).
   *  Resolves to an error message to show, or `null`/void on success. */
  onCreateRoom?: (category: string, name: string, kind: RoomKind) => Promise<string | null> | void;
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
  isPublic,
  memberCount,
  categories,
  activeRoomId,
  threads,
  onOpenRoom,
  onOpenThread,
  onOpenThreads,
  threadsActive = false,
  onJumpTo,
  onOpenSpaceMenu,
  onCreateRoom,
  loading = false,
}: DesktopRoomSidebarProps) {
  const { colors } = useTheme();
  const headerHover = useHover();
  const jumpHover = useHover();
  return (
    <View style={[styles.sidebar, { width: layout.sidebarWidth, backgroundColor: colors.paperAlt, borderRightColor: colors.lineSoft }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Space menu"
        onPress={onOpenSpaceMenu}
        {...headerHover.hoverProps}
        style={[styles.header, { borderBottomColor: colors.lineFaint, backgroundColor: headerHover.hovered ? colors.hover : 'transparent' }]}
      >
        <View style={styles.headerText}>
          <Txt variant="subhead" weight="semibold" numberOfLines={1}>
            {space.name}
          </Txt>
          <SpaceMeta isPublic={isPublic} memberCount={memberCount} iconSize={9} numberOfLines={1} />
        </View>
        <Icon name="gear" size={15} color={colors.inkMuted} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Jump to a room"
        onPress={onJumpTo}
        {...jumpHover.hoverProps}
        style={[styles.jump, { backgroundColor: colors.fill, borderColor: jumpHover.hovered ? colors.accentBorder : colors.lineFaint }]}
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
        {/* Top-of-sidebar destinations (non-room): full-width labeled rows that
            sit ABOVE the channel categories so the sidebar reads as one nav
            stack. Replaces the old tiny IconButton hidden at the foot of the
            spaces rail — a labeled row in the natural reading column is far
            more discoverable on wide web. */}
        {onOpenThreads ? (
          <View style={styles.navGroup}>
            <SidebarLinkRow iconName="thread" label="Threads" active={threadsActive} onPress={onOpenThreads} />
          </View>
        ) : null}
        {loading ? (
          <ChannelListSkeleton />
        ) : categories.length === 0 ? (
          <Txt variant="footnote" tone="inkMuted" style={styles.empty}>
            No rooms yet.
          </Txt>
        ) : (
          categories.map((cat) => (
            <RoomCategorySection
              key={cat.name}
              category={cat}
              activeRoomId={activeRoomId}
              threads={threads}
              onOpenRoom={onOpenRoom}
              onOpenThread={onOpenThread}
              onCreateRoom={onCreateRoom}
            />
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
  navGroup: { paddingBottom: spacing.sm },
  empty: { padding: spacing.md },
});
