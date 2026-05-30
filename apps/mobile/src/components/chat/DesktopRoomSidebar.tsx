import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { layout, radii, spacing } from '@/theme';
import type { Room, RoomKind, Space } from '@/lib/types';
import type { ThreadSummary } from '@/lib/threads';
import type { RoomCategory } from '@/lib/use-rooms';
import { useOnline } from '@/lib/connectivity';
import { useDms } from '@/lib/use-dms';
import { useHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

import { ChannelListSkeleton } from './ChannelListSkeleton';
import { DirectMessagesSection } from './DirectMessagesSection';
import { OfflineBanner } from './OfflineBanner';
import { RoomCategoryList } from './RoomCategoryList';
import { SidebarLinkRow } from './SidebarLinkRow';
import { SpaceMeta } from './SpaceMeta';

interface DesktopRoomSidebarProps {
  space: Space;
  /** Whether the active space is public (plaintext) vs private (E2EE). */
  isPublic: boolean;
  /** Owner + roster for private spaces; null for public (no roster). */
  memberCount?: number | null;
  categories: RoomCategory[];
  /** Signed-in identity — the key (with the space) for persisted collapse state. */
  userId: string;
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
  /** Open the space-wide Pinned view. Omit to hide the row (e.g. no pins yet). */
  onOpenPinned?: () => void;
  /** Highlight the Pinned row as the current destination. */
  pinnedActive?: boolean;
  /** Open the space-wide Automations list (only public spaces with an owner or
   *  existing automations expose this). Omit to hide the row. */
  onOpenAutomations?: () => void;
  /** Highlight the Automations row as the current destination. */
  automationsActive?: boolean;
  onJumpTo?: () => void;
  /** Open the space switcher / join surface (the header acts as a menu). */
  onOpenSpaceMenu?: () => void;
  /** Create a room in a category. `kind` is `'channel'` or `'stream'` (append-only).
   *  Resolves to an error message to show, or `null`/void on success. */
  onCreateRoom?: (category: string, name: string, kind: RoomKind) => Promise<string | null> | void;
  /** OWNER-ONLY: re-home a room into a category (drag-drop). Omit for non-owners. */
  onMoveRoom?: (roomId: string, category: string) => Promise<string | null> | void;
  /** OWNER-ONLY: create a category (shows the "New category" control). */
  onCreateCategory?: (name: string) => Promise<string | null> | void;
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
  userId,
  activeRoomId,
  threads,
  onOpenRoom,
  onOpenThread,
  onOpenThreads,
  threadsActive = false,
  onOpenPinned,
  pinnedActive = false,
  onOpenAutomations,
  automationsActive = false,
  onJumpTo,
  onOpenSpaceMenu,
  onCreateRoom,
  onMoveRoom,
  onCreateCategory,
  loading = false,
}: DesktopRoomSidebarProps) {
  const { colors } = useTheme();
  const online = useOnline();
  const dms = useDms();
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
        {!online ? (
          <View style={styles.banner}>
            <OfflineBanner message="You’re offline — showing your last-synced rooms." />
          </View>
        ) : null}
        {/* Top-of-sidebar destinations (non-room): full-width labeled rows that
            sit ABOVE the channel categories so the sidebar reads as one nav
            stack. Replaces the old tiny IconButton hidden at the foot of the
            spaces rail — a labeled row in the natural reading column is far
            more discoverable on wide web. */}
        {onOpenThreads || onOpenPinned || onOpenAutomations ? (
          <View style={styles.navGroup}>
            {onOpenThreads ? (
              <SidebarLinkRow iconName="thread" label="Threads" active={threadsActive} onPress={onOpenThreads} />
            ) : null}
            {onOpenPinned ? (
              <SidebarLinkRow iconName="pin" label="Pinned" active={pinnedActive} onPress={onOpenPinned} />
            ) : null}
            {onOpenAutomations ? (
              <SidebarLinkRow
                iconName="refresh"
                label="Automations"
                active={automationsActive}
                onPress={onOpenAutomations}
              />
            ) : null}
          </View>
        ) : null}
        {/* DMs are personal + cross-space: a dedicated group above the space's
            channels, reusing the same ChannelRow as the mobile list. */}
        <DirectMessagesSection
          dms={dms}
          activeRoomId={activeRoomId}
          onOpen={(dm) => onOpenRoom({ id: dm.roomId, spaceId: dm.spaceId, category: '', name: dm.name, kind: 'dm' })}
        />
        {loading ? (
          <ChannelListSkeleton />
        ) : categories.length === 0 && !onCreateCategory ? (
          <Txt variant="footnote" tone="inkMuted" style={styles.empty}>
            No rooms yet.
          </Txt>
        ) : (
          <RoomCategoryList
            categories={categories}
            userId={userId}
            spaceId={space.id}
            activeRoomId={activeRoomId}
            threads={threads}
            onOpenRoom={onOpenRoom}
            onOpenThread={onOpenThread}
            onCreateRoom={onCreateRoom}
            onMoveRoom={onMoveRoom}
            onCreateCategory={onCreateCategory}
          />
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
  banner: { paddingBottom: spacing.sm },
  empty: { padding: spacing.md },
});
