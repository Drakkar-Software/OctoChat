import { useMemo, useState } from 'react';
import { Redirect, router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { generateSeedWords } from '@drakkar.software/octochat-sdk';
import { useSession } from '@/lib/session-context';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { StackScreen } from '@/components/ui/StackScreen';
import { SeedBackup } from '@/components/onboarding/SeedBackup';

/** Add-account · create: generate a fresh seed, then append it to the unlocked
 *  vault and switch to it (no PIN step — the vault lock already exists). */
export default function CreateAccountScreen() {
  const { session, addAccount } = useSession();
  const words = useMemo(() => generateSeedWords(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reached without an unlocked vault (e.g. a stale deep link) — nothing to add to.
  if (!session) return <Redirect href="/" />;

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await addAccount(words);
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
      header={
        <AppBar
          title="Backup seed"
          subtitle="New account"
          onBack={() => router.back()}
          right={<IconButton name="x" onPress={() => router.back()} accessibilityLabel="Cancel" />}
        />
      }
      footer={
        <View style={styles.footer}>
          <Button
            label={busy ? 'Adding account…' : "I've written it down  →"}
            variant="primary"
            size="lg"
            full
            loading={busy}
            disabled={busy}
            onPress={confirm}
          />
        </View>
      }
    >
      <SeedBackup words={words} error={error} />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
  footer: { paddingHorizontal: spacing.screenX, paddingTop: spacing.md },
});
