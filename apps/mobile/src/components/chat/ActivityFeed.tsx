import { useMemo } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import type { CrossRoomMessage } from '@/lib/cross-room';
import { getLastRead } from '@/lib/read-state';
import { useActivity } from '@/lib/use-activity';
import { useSession } from '@/lib/session-context';
import { useUnread } from '@/lib/unread-context';
import { useTheme } from '@/lib/use-theme';
import { EmptyState } from '@/components/ui/EmptyState';
import { Txt } from '@/components/ui/Txt';
import { MessageListSkeleton } from '@/components/chat/MessageListSkeleton';
import { MessageResult } from '@/components/chat/MessageResult';

/**
 * Notifications feed: recent messages from OTHER members across rooms, newest
 * first, with unread ones emphasized and a "mark all read" action. Pass a
 * `spaceId` to scope to one space, or `null` to span every space (desktop bell).
 * Reused by the mobile Activity tab and the desktop notifications view.
 */
export function ActivityFeed({ spaceId }: { spaceId: string | null }) {
  const { colors } = useTheme();
  const { session } = useSession();
  const { items, loading } = useActivity(spaceId);
  const { unreadByRoom, markRoomRead } = useUnread();

  // Only other people's messages are "activity" worth notifying about.
  const others = useMemo(
    () => (session ? items.filter((r) => r.msg.authorId !== session.userId) : []),
    [items, session],
  );
  const hasUnread = others.some((r) => (unreadByRoom[r.room.id] ?? 0) > 0);

  const open = (r: CrossRoomMessage) => {
    markRoomRead(r.room.id);
    router.push({ pathname: '/room/[id]', params: { id: r.room.id, name: r.room.name, kind: r.room.kind } });
  };

  const markAll = () => {
    for (const id of new Set(others.map((r) => r.room.id))) markRoomRead(id);
  };

  if (!session) return <EmptyState iconName="lock" title="Sign in first" />;
  if (loading) return <MessageListSkeleton count={5} />;
  if (others.length === 0) {
    return (
      <EmptyState
        iconName="bell"
        title="You're all caught up"
        subtitle="New messages from your teammates will show up here."
      />
    );
  }

  return (
    <View style={styles.flex}>
      {hasUnread ? (
        <View style={styles.header}>
          <Pressable accessibilityRole="button" onPress={markAll} hitSlop={8}>
            <Txt variant="footnote" weight="semibold" color={colors.accent}>
              Mark all read
            </Txt>
          </Pressable>
        </View>
      ) : null}
      <ScrollView style={styles.flex} contentContainerStyle={styles.list}>
        {others.map((r) => (
          <MessageResult
            key={r.room.id + r.msg.id}
            room={r.room}
            msg={r.msg}
            currentUserId={session.userId}
            unread={(unreadByRoom[r.room.id] ?? 0) > 0 && r.msg.ts > getLastRead(r.room.id)}
            onPress={() => open(r)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'flex-end', paddingBottom: spacing.sm },
  list: { gap: spacing.sm, paddingBottom: 96 },
});
