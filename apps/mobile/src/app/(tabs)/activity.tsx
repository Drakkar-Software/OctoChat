import { router } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import type { CrossRoomMessage } from '@/lib/cross-room';
import { useActivity } from '@/lib/use-activity';
import { useSession } from '@/lib/session-context';
import { useSpaces } from '@/lib/use-spaces';
import { AppBar } from '@/components/ui/AppBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { StackScreen } from '@/components/ui/StackScreen';
import { MessageListSkeleton } from '@/components/chat/MessageListSkeleton';
import { MessageResult } from '@/components/chat/MessageResult';

export default function ActivityScreen() {
  const { session } = useSession();
  const { activeId } = useSpaces();
  const { items, loading } = useActivity(activeId);

  const open = (r: CrossRoomMessage) =>
    router.push({ pathname: '/room/[id]', params: { id: r.room.id, name: r.room.name, kind: r.room.kind } });

  return (
    <StackScreen inTabs header={<AppBar title="Activity" />} contentStyle={styles.content}>
      {!session ? (
        <EmptyState iconName="lock" title="Sign in first" />
      ) : loading ? (
        <MessageListSkeleton count={5} />
      ) : items.length === 0 ? (
        <EmptyState
          iconName="bell"
          title="You're all caught up"
          subtitle="Recent messages across your rooms will appear here."
        />
      ) : (
        <ScrollView style={styles.flex} contentContainerStyle={styles.list}>
          {items.map((r) => (
            <MessageResult
              key={r.room.id + r.msg.id}
              room={r.room}
              msg={r.msg}
              currentUserId={session.userId}
              onPress={() => open(r)}
            />
          ))}
        </ScrollView>
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screenX, paddingTop: spacing.md },
  flex: { flex: 1 },
  list: { gap: spacing.sm, paddingBottom: 96 },
});
