import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';

import { spacing } from '@/theme';
import type { CrossRoomThread } from '@/lib/cross-room';
import { useSession } from '@/lib/session-context';
import { useSpaces } from '@/lib/use-spaces';
import { useThreads } from '@/lib/use-threads';
import { AppBar } from '@/components/ui/AppBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { MessageListSkeleton } from '@/components/chat/MessageListSkeleton';
import { ThreadResult } from '@/components/chat/ThreadResult';

export default function ThreadsScreen() {
  const { session } = useSession();
  const { spaces, activeId } = useSpaces();
  const { threads, loading } = useThreads(activeId);
  const space = spaces.find((s) => s.id === activeId);

  const open = (t: CrossRoomThread) =>
    router.push({
      pathname: '/thread/[id]',
      params: { id: t.thread.parentId, roomId: t.room.id, roomName: t.room.name, kind: t.room.kind },
    });

  return (
    <StackScreen inTabs header={<AppBar title="Threads" subtitle={space?.name} />} contentStyle={styles.content}>
      {!session ? (
        <SignInPrompt />
      ) : loading && threads.length === 0 ? (
        <MessageListSkeleton count={4} />
      ) : threads.length === 0 ? (
        <EmptyState
          iconName="thread"
          title="No threads yet"
          subtitle="Replies you and your teammates start in this space gather here."
        />
      ) : (
        // Virtualized via LegendList, mirroring Search: recycleItems off (rows hold
        // hover state) and a separator stands in for the container `gap`.
        <LegendList
          style={styles.flex}
          contentContainerStyle={styles.list}
          data={threads}
          keyExtractor={(t) => t.room.id + t.thread.parentId}
          estimatedItemSize={92}
          ItemSeparatorComponent={Separator}
          renderItem={({ item: t }) => (
            <ThreadResult room={t.room} thread={t.thread} currentUserId={session.userId} onPress={() => open(t)} />
          )}
        />
      )}
    </StackScreen>
  );
}

/** Spacer between rows — the virtualized list can't honor the container `gap`. */
const Separator = () => <View style={styles.gap} />;

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screenX, paddingTop: spacing.md, gap: spacing.md },
  flex: { flex: 1 },
  list: { paddingBottom: 96 },
  gap: { height: spacing.sm },
});
