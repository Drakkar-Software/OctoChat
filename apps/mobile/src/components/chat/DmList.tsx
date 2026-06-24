import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Room } from '@drakkar.software/octochat-sdk';
import type { ThreadSummary } from '@drakkar.software/octochat-sdk';
import type { DmEntry } from '@/lib/use-dms';
import { useRefreshDmHeads } from '@/lib/use-dms';
import { useArchivedDms } from '@/lib/use-archived-dms';
import { useTheme } from '@/lib/use-theme';
import { spacing } from '@/theme';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

import { ChannelRow } from './ChannelRow';
import { DmActionsSheet } from './DmActionsSheet';
import { ThreadRow } from './ThreadRow';

interface DmListProps {
  dms: DmEntry[];
  activeRoomId?: string;
  /** Recent threads of the active DM — rendered indented under its row (desktop
   *  sidebar), mirroring a channel's thread digest. Omit to show none. */
  threads?: ThreadSummary[];
  onOpen: (dm: DmEntry) => void;
  /** Open one of the active DM's threads (the reply target's message id). */
  onOpenThread?: (parentId: string) => void;
}

/**
 * The contents of the virtual DM space: one {@link ChannelRow} per conversation
 * (reusing the `kind:'dm'` person-monogram + unread path), or an empty state that
 * explains how to start a DM. Used by the mobile rooms screen AND the desktop room
 * sidebar so both surfaces stay identical. Each DM's name/initials are the PEER's
 * (viewer-correct — see `use-dms`).
 *
 * The list is split into **active** (unarchived, or archived-but-unread) and
 * **archived** (archived + no unread) entries. Archived entries are hidden behind a
 * collapsible "Show archived" toggle at the bottom of the list. Long-pressing a row
 * (or right-clicking on web) opens a {@link DmActionsSheet} to archive / unarchive.
 */
export function DmList({ dms, activeRoomId, threads, onOpen, onOpenThread }: DmListProps) {
  // Refresh the authoritative DM head-timestamps (sort key) while the list is visible.
  // Placed before any conditional returns to satisfy rules of hooks.
  useRefreshDmHeads();
  const { colors } = useTheme();
  const { setDmArchived } = useArchivedDms();
  const [showArchived, setShowArchived] = useState(false);
  const [sheetDm, setSheetDm] = useState<DmEntry | null>(null);

  // A DM is hidden only when it is archived AND has no unread messages. The
  // `unread > 0` guard is the render-time backstop for auto-resurface: an unread DM
  // is always visible even if the optimistic un-archive write hasn't settled yet.
  const active = dms.filter((d) => !d.archived || d.unread > 0);
  const archived = dms.filter((d) => d.archived && d.unread === 0);

  const renderRow = (dm: DmEntry) => {
    const room: Room = {
      id: dm.roomId,
      spaceId: dm.spaceId,
      category: '',
      name: dm.name,
      kind: 'dm',
      avatar: dm.initials,
      unread: dm.unread,
    };
    return (
      <Fragment key={dm.spaceId}>
        <ChannelRow
          room={room}
          avatarImage={dm.image}
          active={dm.roomId === activeRoomId}
          onPress={() => onOpen(dm)}
          onLongPress={() => setSheetDm(dm)}
        />
        {dm.roomId === activeRoomId && threads?.length
          ? threads.map((t) => (
              <ThreadRow key={t.parentId} thread={t} onPress={() => onOpenThread?.(t.parentId)} />
            ))
          : null}
      </Fragment>
    );
  };

  if (active.length === 0 && archived.length === 0) {
    return (
      <EmptyState
        iconName="dm"
        title="No direct messages yet"
        subtitle="Open someone's profile and tap Message to start a private, encrypted conversation. You can DM anyone you share a private space with."
      />
    );
  }

  return (
    <>
      {active.map(renderRow)}

      {archived.length > 0 && (
        <>
          {/* Toggle row */}
          <Pressable
            onPress={() => setShowArchived((v) => !v)}
            style={({ pressed }) => [
              styles.archiveToggle,
              { backgroundColor: pressed ? colors.hover : 'transparent' },
            ]}
            accessibilityRole="button"
            accessibilityLabel={showArchived ? 'Hide archived messages' : `Show archived messages (${archived.length})`}
          >
            <Icon
              name={showArchived ? 'chevron-down' : 'chevron-right'}
              size={13}
              color={colors.inkMuted}
            />
            <Txt variant="footnote" tone="inkMuted" style={styles.archiveLabel}>
              {showArchived ? 'Hide archived' : `Archived (${archived.length})`}
            </Txt>
          </Pressable>

          {showArchived && (
            <View style={styles.archivedSection}>
              {archived.map(renderRow)}
            </View>
          )}
        </>
      )}

      <DmActionsSheet
        visible={sheetDm !== null}
        dm={sheetDm}
        onArchive={(dm) => setDmArchived(dm.spaceId, true)}
        onUnarchive={(dm) => setDmArchived(dm.spaceId, false)}
        onClose={() => setSheetDm(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  archiveToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.xs,
    borderRadius: 6,
  },
  archiveLabel: {
    flex: 1,
  },
  archivedSection: {
    opacity: 0.75,
  },
});
