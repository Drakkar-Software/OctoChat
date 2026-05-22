import { useMemo } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';

import { spacing } from '@/theme';
import type { Room, Space } from '@/lib/types';
import { useSession } from '@/lib/session-context';
import { useRooms } from '@/lib/use-rooms';
import { useSpaces } from '@/lib/use-spaces';
import { useUnread } from '@/lib/unread-context';
import { useTheme } from '@/lib/use-theme';
import { spaceIdFromRoomId } from '@/lib/starfish/paths';
import { EmptyState } from '@/components/ui/EmptyState';
import { Txt } from '@/components/ui/Txt';
import { ChannelRow } from '@/components/chat/ChannelRow';

/**
 * Notifications view — rooms with unread messages, grouped by space. Counts come
 * from the SSE-driven unread provider; room names come from the (plaintext) room
 * registry the sidebar already loads. No message content, no message pull.
 * `spaceId` scopes to one space (mobile tab); `null` spans all (desktop bell).
 */
export function ActivityFeed({ spaceId }: { spaceId: string | null }) {
  const { colors } = useTheme();
  const { session } = useSession();
  const { spaces } = useSpaces();
  const { unreadByRoom, markRoomRead } = useUnread();

  // Only spaces in scope that actually have unread render a section (so we never
  // read the registry for caught-up spaces).
  const sections = useMemo(
    () => spaces.filter((s) => (!spaceId || s.id === spaceId) && (s.unread ?? 0) > 0),
    [spaces, spaceId],
  );

  const open = (room: Room) => {
    markRoomRead(room.id);
    router.push({ pathname: '/room/[id]', params: { id: room.id, name: room.name, kind: room.kind } });
  };

  const markAll = () => {
    for (const roomId of Object.keys(unreadByRoom)) {
      if (!spaceId || spaceIdFromRoomId(roomId) === spaceId) markRoomRead(roomId);
    }
  };

  if (!session) return <EmptyState iconName="lock" title="Sign in first" />;
  if (sections.length === 0) {
    return (
      <EmptyState
        iconName="bell"
        title="You're all caught up"
        subtitle="New messages in your rooms will show up here."
      />
    );
  }

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={markAll} hitSlop={8}>
          <Txt variant="footnote" weight="semibold" color={colors.accent}>
            Mark all read
          </Txt>
        </Pressable>
      </View>
      {/* Virtualized at the space-section grain: each SpaceSection lazy-loads its
          own rooms via useRooms, so we list the spaces rather than a flattened
          SectionList. recycleItems stays off because that per-section hook holds
          async state (mirrors RoomConversation); a separator stands in for the
          container `gap` a virtualized list ignores. */}
      <LegendList
        style={styles.flex}
        contentContainerStyle={styles.list}
        data={sections}
        keyExtractor={(s) => s.id}
        estimatedItemSize={140}
        ItemSeparatorComponent={Separator}
        renderItem={({ item: s }) => <SpaceSection space={s} onOpen={open} />}
      />
    </View>
  );
}

/** One space's unread rooms, rendered as reused ChannelRows (which carry the badge). */
function SpaceSection({ space, onOpen }: { space: Space; onOpen: (r: Room) => void }) {
  const { rooms } = useRooms(space.id);
  const unread = rooms.filter((r) => (r.unread ?? 0) > 0);
  if (unread.length === 0) return null;
  return (
    <View style={styles.section}>
      <Txt variant="caption" weight="semibold" tone="inkMuted">
        {space.name}
      </Txt>
      {unread.map((r) => (
        <ChannelRow key={r.id} room={r} onPress={() => onOpen(r)} />
      ))}
    </View>
  );
}

/** Spacer between space sections — the virtualized list can't honor the container `gap`. */
const Separator = () => <View style={styles.gap} />;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'flex-end', paddingBottom: spacing.sm },
  list: { paddingBottom: 96 },
  gap: { height: spacing.md },
  section: { gap: spacing.xs },
});
