import { Redirect, router } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { AppBar } from '@/components/ui/AppBar';
import { StackScreen } from '@/components/ui/StackScreen';
import { SeedRecoverForm } from '@/components/onboarding/SeedRecoverForm';

export default function RecoverScreen() {
  const { prepareSignIn, session } = useSession();

  // Already signed in: recovering here creates a NEW first account and replaces the
  // vault. Adding an existing seed as another account goes through /account/recover.
  if (session) return <Redirect href="/(tabs)/rooms" />;

  const restore = (words: string[]) => {
    prepareSignIn(words);
    // Web requires PIN/passkey setup first; native delegates the derivation wait to creating.
    router.push(Platform.OS === 'web' ? '/(onboarding)/lock' : '/(onboarding)/creating');
  };

  return (
    <StackScreen
      scroll
      contentStyle={styles.content}
      header={<AppBar title="Recover identity" subtitle="enter your 12-word seed" onBack={() => router.back()} />}
    >
      <SeedRecoverForm submitLabel="Recover" busy={false} onSubmit={restore} />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
});
