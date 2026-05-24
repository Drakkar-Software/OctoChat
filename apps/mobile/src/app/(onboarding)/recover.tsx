import { useState } from 'react';
import { Redirect, router } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { AppBar } from '@/components/ui/AppBar';
import { StackScreen } from '@/components/ui/StackScreen';
import { SeedRecoverForm } from '@/components/onboarding/SeedRecoverForm';

export default function RecoverScreen() {
  const { signIn, prepareSignIn, session } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in: recovering here creates a NEW first account and replaces the
  // vault. Adding an existing seed as another account goes through /account/recover.
  if (session) return <Redirect href="/(tabs)/rooms" />;

  const restore = async (words: string[]) => {
    // First account on web: seal the recovered seed behind a PIN/passkey first.
    if (Platform.OS === 'web') {
      prepareSignIn(words);
      router.push('/(onboarding)/lock');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(words);
      router.replace('/(tabs)/rooms');
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setBusy(false);
    }
  };

  return (
    <StackScreen
      scroll
      contentStyle={styles.content}
      header={<AppBar title="Recover identity" subtitle="enter your 12-word seed" onBack={() => router.back()} />}
    >
      <SeedRecoverForm submitLabel="Recover" busy={busy} error={error} onSubmit={restore} />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
});
