import { Redirect, router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { AppBar } from '@/components/ui/AppBar';
import { StackScreen } from '@/components/ui/StackScreen';
import { SeedLockSetup } from '@/components/onboarding/SeedLockSetup';

/** Web set-lock step: seal the staged identity (seed or Nostr-derived) behind a
 *  PIN (+ optional passkey). One vault format covers both origins. */
export default function LockScreen() {
  const {
    pendingSeed,
    pendingNostrIdentity,
    passkeyAvailable,
    signIn,
    signInWithRootIdentity,
    session,
  } = useSession();

  // Already signed in: this screen creates the FIRST account's app-lock, so running
  // signIn here would replace the whole vault. Adding accounts goes through
  // addAccount (no lock step), so bounce back into the app.
  if (session) return <Redirect href="/(tabs)/rooms" />;
  // Reached without anything staged (e.g. a direct reload) — restart onboarding.
  // Branch order matches the staging order: the welcome handlers only set one of
  // the two at a time, so checking nostr first is enough.
  if (!pendingNostrIdentity && !pendingSeed) return <Redirect href="/(onboarding)/welcome" />;

  const onSubmit = pendingNostrIdentity
    ? (lock: Parameters<typeof signInWithRootIdentity>[2]) =>
        signInWithRootIdentity(pendingNostrIdentity.root, pendingNostrIdentity.name, lock)
    : (lock: Parameters<typeof signIn>[2]) => signIn(pendingSeed!.words, pendingSeed!.name, lock);

  return (
    <StackScreen
      scroll
      contentStyle={styles.content}
      header={<AppBar title="Secure your account" subtitle="Set a PIN" onBack={() => router.back()} />}
    >
      <SeedLockSetup
        passkeyAvailable={passkeyAvailable}
        onSubmit={onSubmit}
        onDone={() => router.replace('/(tabs)/rooms')}
      />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
});
