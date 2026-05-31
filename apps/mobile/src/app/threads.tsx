import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import type { CrossRoomThread } from '@/lib/cross-room';
import { useInShell } from '@/lib/use-responsive';
import { useSession } from '@/lib/session-context';
import { useSpaces } from '@/lib/use-spaces';
import { useThreads } from '@/lib/use-threads';
import { AppBar } from '@/components/ui/AppBar';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { ThreadList } from '@/components/chat/ThreadList';

export default function ThreadsScreen() {
  const { session } = useSession();
  const inShell = useInShell();
  const { spaces, activeId } = useSpaces();
  const { threads, loading } = useThreads(activeId);
  const space = spaces.find((s) => s.id === activeId);

  // Reached by pushing /threads from the Chat tab (mobile) — needs a back action;
  // on the desktop shell it sits in the main pane, where the sidebar is the nav.
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/rooms'));

  const open = (t: CrossRoomThread) =>
    router.push({
      pathname: '/thread/[id]',
      params: { id: t.thread.parentId, roomId: t.room.id, roomName: t.room.name, kind: t.room.kind },
    });

  return (
    <StackScreen header={<AppBar title="Threads" subtitle={space?.name} onBack={inShell ? undefined : goBack} />} contentStyle={styles.content}>
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
