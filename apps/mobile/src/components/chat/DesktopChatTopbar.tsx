import { StyleSheet, View } from 'react-native';

import { layout, shadows, spacing } from '@/theme';
import type { RoomKind } from '@drakkar.software/octochat-sdk';
import { useTheme } from '@/lib/use-theme';
import { useArchivedDms } from '@/lib/use-archived-dms';
import { useDms } from '@/lib/use-dms';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';

interface DesktopChatTopbarProps {
  name: string;
  kind?: RoomKind;
  /** The room's space id — used to resolve a DM peer's avatar (image + monogram). */
  spaceId?: string;
  onSearch?: () => void;
  onDetails?: () => void;
  /** DM only: open the full thread list with this peer. Omit to hide the action. */
  onThreads?: () => void;
  /** DM only: navigate back to the DM list after archiving (called after the
   *  archive toggle fires). */
  onArchived?: () => void;
  /** Ticket only: open the ticket actions sheet (status picker + archive).
   *  Omit to hide the action (non-ticket rooms). */
  onTicketActions?: () => void;
}

/**
 * The 52px toolbar above the main pane on desktop: the room's kind glyph + name
 * on the left, search + details on the right. Replaces the centered mobile
 * {@link AppBar} when the app is in shell mode — so it must carry the same
 * right-hand affordances (the info button routes to space details, or an
 * automated room's settings sheet).
 *
 * A DM header shows the PEER's real avatar (image with monogram fallback) — the
 * same {@link Avatar} the chat messages use — instead of a generic people glyph,
 * resolved from the shared DM list (same profile cache, no extra request). It also
 * carries an Archive toggle (archive icon when active, unarchived) so the user can
 * archive/unarchive without leaving the conversation.
 */
export function DesktopChatTopbar({ name, kind = 'channel', spaceId, onSearch, onDetails, onThreads, onArchived, onTicketActions }: DesktopChatTopbarProps) {
  const { colors } = useTheme();
  const dms = useDms();
  const { isDmArchived, setDmArchived } = useArchivedDms();
  const dm = kind === 'dm' ? dms.find((d) => d.spaceId === spaceId) : undefined;
  const isArchived = kind === 'dm' && spaceId ? isDmArchived(spaceId) : false;

  const handleArchive = () => {
    if (!spaceId) return;
    const nowArchiving = !isArchived;
    setDmArchived(spaceId, nowArchiving);
    if (nowArchiving) onArchived?.();
  };

  return (
    <View
      style={[
        styles.bar,
        shadows.sm,
        { height: layout.desktopTopbarHeight, backgroundColor: colors.paper, borderBottomColor: colors.lineSoft, borderTopColor: colors.hairlineHi },
      ]}
    >
      {kind === 'dm' ? (
        <Avatar label={dm?.initials ?? name.slice(0, 2).toUpperCase()} image={dm?.image} size={24} />
      ) : (
        <Icon
          name={kind === 'automated' ? 'zap' : 'hash'}
          size={16}
          color={colors.inkSoft}
        />
      )}
      <Txt variant="subhead" weight="semibold" numberOfLines={1} style={styles.name}>
        {name}
      </Txt>
      {onThreads ? (
        <IconButton name="thread" size={16} onPress={onThreads} accessibilityLabel="All threads with this person" />
      ) : null}
      {onTicketActions ? (
        <IconButton name="check-circle" size={16} onPress={onTicketActions} accessibilityLabel="Ticket actions" />
      ) : null}
      {kind === 'dm' ? (
        <IconButton
          name="archive"
          size={16}
          onPress={handleArchive}
          accessibilityLabel={isArchived ? 'Unarchive this conversation' : 'Archive this conversation'}
        />
      ) : null}
      <IconButton name="search" size={16} onPress={onSearch} accessibilityLabel="Search in room" />
      <IconButton name="info" size={16} onPress={onDetails} accessibilityLabel="Space details" />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    // Lit top edge — the paper catches light from above and floats over the stream.
    borderTopWidth: 1,
  },
  name: { flex: 1, minWidth: 0 },
});
