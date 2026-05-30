import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import type { Room } from '@/lib/types';
import type { DmEntry } from '@/lib/use-dms';
import { Txt } from '@/components/ui/Txt';

import { ChannelRow } from './ChannelRow';

interface DirectMessagesSectionProps {
  dms: DmEntry[];
  activeRoomId?: string;
  onOpen: (dm: DmEntry) => void;
}

/**
 * The "Direct Messages" group in the room list / desktop sidebar — a category-style
 * header over one {@link ChannelRow} per DM. Reuses ChannelRow's `kind==='dm'` path
 * (person monogram avatar + unread badge) so a DM reads distinctly from a `#channel`
 * with no new row markup. Renders nothing when there are no DMs (no empty noise).
 *
 * Each DM's `name`/`initials` are the PEER's (viewer-correct — see `use-dms`), not the
 * shared registry's stored name.
 */
export function DirectMessagesSection({ dms, activeRoomId, onOpen }: DirectMessagesSectionProps) {
  if (dms.length === 0) return null;
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Txt variant="micro" weight="bold" mono uppercase tone="inkMuted">
          Direct Messages
        </Txt>
      </View>
      {dms.map((dm) => {
        // Synthetic Room so the shared ChannelRow renders the DM (monogram + unread).
        const room: Room = {
          id: dm.roomId,
          spaceId: dm.spaceId,
          category: '',
          name: dm.name,
          kind: 'dm',
          avatar: dm.initials,
          unread: dm.unread,
        };
        return <ChannelRow key={dm.spaceId} room={room} active={dm.roomId === activeRoomId} onPress={() => onOpen(dm)} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.sm },
  // Match RoomCategorySection's header padding so DMs read as a peer group.
  header: { paddingVertical: 6, paddingHorizontal: spacing.md },
});
