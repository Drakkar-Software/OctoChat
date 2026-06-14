import { useEffect } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { layout, radii, spacing } from '@/theme';
import type { Room, Space } from '@drakkar.software/octochat-sdk';
import type { ThreadSummary } from '@drakkar.software/octochat-sdk';
import { excludeAutomatedRooms, type RoomCategory } from '@/lib/use-rooms';
import { useOnline } from '@/lib/connectivity';
import { DM_HOME_NAME } from '@/lib/dm-home';
import type { DmEntry } from '@/lib/use-dms';
import { useHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';
import { useViewMode } from '@/lib/view-mode';
import { Divider } from '@/components/ui/Divider';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

import { AgentsPanel } from './AgentsPanel';
import { ChannelListSkeleton } from './ChannelListSkeleton';
import { DmList } from './DmList';
import { ModeSwitcher } from './ModeSwitcher';
import { OfflineBanner } from './OfflineBanner';
import { RoomCategoryList } from './RoomCategoryList';
import { SidebarLinkRow } from './SidebarLinkRow';
import { SpaceMeta } from './SpaceMeta';

interface DesktopRoomSidebarProps {
  /** The active space — undefined when the virtual DM space is selected. */
  space?: Space;
  /** True when the virtual DM space is selected: render the DM list, not a space. */
  isDmHome?: boolean;
  /** Every DM (across all peers), for the DM-home view. */
  dms?: DmEntry[];
  /** Owner + roster for private spaces; null for public (no roster). */
  memberCount?: number | null;
  categories?: RoomCategory[];
  /** Signed-in identity — the key (with the space) for persisted collapse state. */
  userId: string;
  activeRoomId?: string;
  /** Recent threads of the active room, listed under its row. Omit to show none. */
  threads?: ThreadSummary[];
  onOpenRoom: (room: Room) => void;
  /** Open the public-space directory (Explore). Space-independent, so it heads
   *  the nav group above the space-scoped destinations. */
  onOpenExplore?: () => void;
  /** Highlight the Explore row as the current destination. */
  exploreActive?: boolean;
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
  /** Create a room in a category (every room is the same append-only kind now).
   *  Resolves to an error message to show, or `null`/void on success. */
  onCreateRoom?: (category: string, name: string) => Promise<string | null> | void;
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
 *
 * In DM-home mode ({@link isDmHome}) the same shell renders a "Direct Messages"
 * header over the full {@link DmList} (every peer's DM) instead — the virtual DM
 * space has no jump-to, nav group or categories.
 */
export function DesktopRoomSidebar({
  space,
  isDmHome = false,
  dms = [],
  memberCount,
  categories = [],
  userId,
  activeRoomId,
  threads,
  onOpenRoom,
  onOpenExplore,
  exploreActive = false,
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
  const { mode, setMode } = useViewMode();
  const headerHover = useHover();
  const jumpHover = useHover();

  // Make the advertised ⌘K / Ctrl+K shortcut real (web): focus the jump-to action.
  useEffect(() => {
    if (Platform.OS !== 'web' || !onJumpTo) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onJumpTo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onJumpTo]);

  // The virtual DM space: same sidebar shell, a "Direct Messages" header over the full
  // DM list — no jump-to, nav group or categories (none apply to DMs).
  if (isDmHome) {
    return (
      <View style={[styles.sidebar, { width: layout.sidebarWidth, backgroundColor: colors.paperAlt, borderRightColor: colors.lineSoft }]}>
        <View style={[styles.header, { borderBottomColor: colors.lineFaint }]}>
          <View style={styles.headerText}>
            <Txt variant="subhead" weight="semibold" numberOfLines={1}>
              {DM_HOME_NAME}
            </Txt>
          </View>
          <Icon name="people" size={15} color={colors.inkMuted} />
        </View>
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {!online ? (
            <View style={styles.banner}>
              <OfflineBanner message="You’re offline — showing your last-synced DMs." />
            </View>
          ) : null}
          <DmList
            dms={dms}
            activeRoomId={activeRoomId}
            threads={threads}
            onOpen={(dm) => onOpenRoom({ id: dm.roomId, spaceId: dm.spaceId, category: '', name: dm.name, kind: 'dm' })}
            onOpenThread={onOpenThread}
          />
        </ScrollView>
      </View>
    );
  }

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
            {space?.name}
          </Txt>
          <SpaceMeta memberCount={memberCount} iconSize={9} numberOfLines={1} />
        </View>
        <Icon name="gear" size={15} color={colors.inkMuted} />
      </Pressable>

      <View style={styles.switcher}>
        <ModeSwitcher mode={mode} onChange={setMode} />
      </View>

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
        {/* The mode switcher swaps THIS list only — the open room in the main
            pane is untouched. Agents = this space's automations; Work = the
            docs/projects/knowledge placeholder; Chat = rooms, threads & pins. */}
        {mode === 'agents' ? (
          <AgentsPanel
            categories={categories}
            activeRoomId={activeRoomId}
            onOpenRoom={onOpenRoom}
            onOpenAutomations={onOpenAutomations}
            automationsActive={automationsActive}
          />
        ) : (
          <>
            {!online ? (
              <View style={styles.banner}>
                <OfflineBanner message="You’re offline — showing your last-synced rooms." />
              </View>
            ) : null}
            {/* Top-of-sidebar destinations (non-room): full-width labeled rows that
                sit ABOVE the channel categories so the sidebar reads as one nav
                stack. Automations moved to the Agents mode above. */}
            {onOpenExplore || onOpenThreads || onOpenPinned ? (
              <>
                <View style={styles.navGroup}>
                  {onOpenExplore ? (
                    <SidebarLinkRow iconName="globe" label="Explore" active={exploreActive} onPress={onOpenExplore} />
                  ) : null}
                  {onOpenThreads ? (
                    <SidebarLinkRow iconName="thread" label="Threads" active={threadsActive} onPress={onOpenThreads} />
                  ) : null}
                  {onOpenPinned ? (
                    <SidebarLinkRow iconName="pin" label="Pinned" active={pinnedActive} onPress={onOpenPinned} />
                  ) : null}
                </View>
                {/* Separate the nav destinations from the channel list. */}
                <Divider style={styles.navDivider} />
              </>
            ) : null}
            {loading ? (
              <ChannelListSkeleton />
            ) : categories.length === 0 && !onCreateCategory ? (
              <Txt variant="footnote" tone="inkMuted" style={styles.empty}>
                No rooms yet.
              </Txt>
            ) : (
              <RoomCategoryList
                categories={excludeAutomatedRooms(categories)}
                userId={userId}
                spaceId={space?.id ?? ''}
                activeRoomId={activeRoomId}
                threads={threads}
                onOpenRoom={onOpenRoom}
                onOpenThread={onOpenThread}
                onCreateRoom={onCreateRoom}
                onMoveRoom={onMoveRoom}
                onCreateCategory={onCreateCategory}
              />
            )}
          </>
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
  switcher: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
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
  navDivider: { marginHorizontal: spacing.xs, marginBottom: spacing.sm },
  banner: { paddingBottom: spacing.sm },
  empty: { padding: spacing.md },
});
