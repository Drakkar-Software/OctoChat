import { Redirect, router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { AppBar } from '@/components/ui/AppBar';
import { StackScreen } from '@/components/ui/StackScreen';
import { SeedLockSetup } from '@/components/onboarding/SeedLockSetup';

/** Web set-lock step: seal the staged seed behind a PIN (+ optional passkey). */
export default function LockScreen() {
  const { pendingSeed, passkeyAvailable, signIn, session } = useSession();

  // Already signed in: this screen creates the FIRST account's app-lock, so running
  // signIn here would replace the whole vault. Adding accounts goes through
  // addAccount (no lock step), so bounce back into the app.
  if (session) return <Redirect href="/(tabs)/rooms" />;
  // Reached without a staged seed (e.g. a direct reload) — restart onboarding.
  if (!pendingSeed) return <Redirect href="/(onboarding)/welcome" />;

  return (
    <StackScreen
      scroll
      contentStyle={styles.content}
      header={<AppBar title="Secure your account" subtitle="Set a PIN" onBack={() => router.back()} />}
    >
      <SeedLockSetup
        passkeyAvailable={passkeyAvailable}
        onSubmit={(lock) => signIn(pendingSeed.words, pendingSeed.name, lock)}
        onDone={() => router.replace('/(tabs)/rooms')}
      />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
});
