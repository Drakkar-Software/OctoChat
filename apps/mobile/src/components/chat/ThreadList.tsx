import { StyleSheet, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';

import { spacing } from '@/theme';
import type { CrossRoomThread } from '@/lib/cross-room';
import { EmptyState } from '@/components/ui/EmptyState';
import { MessageListSkeleton } from '@/components/chat/MessageListSkeleton';
import { ThreadResult } from '@/components/chat/ThreadResult';

interface ThreadListProps {
  threads: CrossRoomThread[];
  loading: boolean;
  currentUserId: string;
  onOpen: (t: CrossRoomThread) => void;
}

/**
 * The virtualized list of every thread across a space's rooms — a skeleton while
 * the first decrypt runs, an empty state when there are none, else a
 * {@link ThreadResult} per thread. Shared by the Threads tab and the per-DM
 * "all threads" screen so both render identically.
 */
export function ThreadList({ threads, loading, currentUserId, onOpen }: ThreadListProps) {
  if (loading && threads.length === 0) {
    return <MessageListSkeleton count={4} />;
  }
  if (threads.length === 0) {
    return (
      <EmptyState
        iconName="thread"
        title="No threads yet"
        subtitle="Replies you and your teammates start in this space gather here."
      />
    );
  }
  // Virtualized via LegendList, mirroring Search: recycleItems off (rows hold
  // hover state) and a separator stands in for the container `gap`.
  return (
    <LegendList
      style={styles.flex}
      contentContainerStyle={styles.list}
      data={threads}
      keyExtractor={(t) => t.room.id + t.thread.parentId}
      estimatedItemSize={92}
      ItemSeparatorComponent={Separator}
      renderItem={({ item: t }) => (
        <ThreadResult room={t.room} thread={t.thread} currentUserId={currentUserId} onPress={() => onOpen(t)} />
      )}
    />
  );
}

/** Spacer between rows — the virtualized list can't honor the container `gap`. */
const Separator = () => <View style={styles.gap} />;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingBottom: 96 },
  gap: { height: spacing.sm },
});
