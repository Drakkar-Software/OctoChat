import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import type { CrossRoomThread } from '@drakkar.software/octochat-sdk';
import { useSession } from '@/lib/session-context';
import { useThreads } from '@/lib/use-threads';
import { AppBar } from '@/components/ui/AppBar';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { ThreadList } from '@/components/chat/ThreadList';

/**
 * Every thread of a single space, as a pushed (back-navigable) screen — the full
 * counterpart to the 3-thread digest the sidebar shows under a room. Reached from
 * a DM's header ("all threads with this person"), scoped to that DM's `dm-` space.
 * Reuses {@link useThreads} + {@link ThreadList}, the same pair behind the Threads
 * tab; only the chrome differs (a back arrow + the peer's name).
 */
export default function SpaceThreadsScreen() {
  const params = useLocalSearchParams<{ spaceId: string; peer?: string }>();
  const spaceId = params.spaceId;
  const { session } = useSession();
  const { threads, loading } = useThreads(spaceId);

  // Cold-start safety: a deep link here may have no parent to pop back to.
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/rooms'));
  const open = (t: CrossRoomThread) =>
    router.push({
      pathname: '/thread/[id]',
      params: { id: t.thread.parentId, roomId: t.room.id, roomName: t.room.name, kind: t.room.kind },
    });

  return (
    <StackScreen header={<AppBar title="Threads" subtitle={params.peer} onBack={goBack} />} contentStyle={styles.content}>
      {!session ? (
        <SignInPrompt />
      ) : (
        <ThreadList threads={threads} loading={loading} currentUserId={session.userId} onOpen={open} />
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screenX, paddingTop: spacing.md, gap: spacing.md },
});
