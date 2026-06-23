import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { useInShell } from '@/lib/use-responsive';
import { useSession } from '@/lib/session-context';
import { useSpaces } from '@/lib/use-spaces';
import { AppBar } from '@/components/ui/AppBar';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { PendingRequestList } from '@/components/desk/PendingRequestList';

/** Owner-side list of pending ticket / room requests for the active space.
 *  Reached by tapping the "Requests (N)" count in the sidebar or mobile room list.
 *  Accepts or declines individual requests; the count in the sidebar updates
 *  immediately on each action via the shared RequestsProvider. */
export default function RequestsScreen() {
  const { session } = useSession();
  const inShell = useInShell();
  const { spaces, activeId } = useSpaces();
  const space = spaces.find((s) => s.id === activeId);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/rooms'));

  return (
    <StackScreen
      header={<AppBar title="Requests" subtitle={space?.name} onBack={inShell ? undefined : goBack} />}
      contentStyle={styles.content}
    >
      {!session ? (
        <SignInPrompt />
      ) : (
        <PendingRequestList spaceId={activeId ?? space?.id ?? ''} />
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screenX, paddingTop: spacing.md, gap: spacing.md },
});
