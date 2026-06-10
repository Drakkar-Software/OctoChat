import { useState } from 'react';
import { Redirect, router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { AppBar } from '@/components/ui/AppBar';
import { IconButton } from '@/components/ui/IconButton';
import { StackScreen } from '@/components/ui/StackScreen';
import { AccountFlowHeader } from '@/components/account/AccountFlowHeader';
import { SeedRecoverForm } from '@/components/onboarding/SeedRecoverForm';

/** Add-account · recover: append an existing seed to the unlocked vault and
 *  switch to it (no PIN step). */
export default function RecoverAccountScreen() {
  const { session, addAccount } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reached without an unlocked vault (e.g. a stale deep link) — nothing to add to.
  if (!session) return <Redirect href="/" />;

  const add = async (words: string[]) => {
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
          title="Recover identity"
          subtitle="Add an existing account"
          onBack={() => router.back()}
          right={<IconButton name="x" onPress={() => router.back()} accessibilityLabel="Cancel" />}
        />
      }
    >
      <AccountFlowHeader title="Restore from seed" subtitle="Enter the 12-word seed of an existing account to add it here." />
      <SeedRecoverForm submitLabel="Add account" busy={busy} error={error} onSubmit={add} />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
});
