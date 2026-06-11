import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { useDms, type DmEntry } from '@/lib/use-dms';
import { AppBar } from '@/components/ui/AppBar';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { DmList } from '@/components/chat/DmList';
import { ScanDmButton } from '@/components/dm/ScanDmButton';
import { ShareDmButton } from '@/components/dm/ShareDmButton';

/**
 * Direct Messages bottom tab. Lists every DM (across all peers) via the global
 * `useDms()` hook and `DmList`. The header carries the two DM identity actions —
 * share your own "DM me" QR ({@link ShareDmButton}) and scan someone else's
 * ({@link ScanDmButton}, native-only) — so they're one tap away from the list.
 */
export default function DmsScreen() {
  const { session } = useSession();
  const dms = useDms();
  const openDm = (dm: DmEntry) =>
    router.push({ pathname: '/room/[id]', params: { id: dm.roomId, name: dm.name, kind: 'dm' } });
  return (
    <StackScreen
      inTabs
      scroll
      header={
        <AppBar
          title="Direct Messages"
          left={session ? <ShareDmButton /> : undefined}
          right={session ? <ScanDmButton /> : undefined}
        />
      }
      contentStyle={styles.content}
    >
      {!session ? (
        <SignInPrompt subtitle="Create an identity to see your direct messages." />
      ) : (
        <View style={styles.dmHome}>
          <DmList dms={dms} onOpen={openDm} />
        </View>
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: 96 },
  dmHome: { minHeight: 320 },
});
