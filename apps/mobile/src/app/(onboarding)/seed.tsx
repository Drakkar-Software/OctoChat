import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { generateSeedWords } from '@/lib/starfish/identity';
import { useSession } from '@/lib/session-context';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { IconButton } from '@/components/ui/IconButton';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';
import { SeedGrid } from '@/components/onboarding/SeedGrid';

export default function SeedScreen() {
  const { signIn, prepareSignIn } = useSession();
  const words = useMemo(() => generateSeedWords(), []);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = () => {
    try {
      (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => void } } }).navigator?.clipboard?.writeText?.(
        words.join(' '),
      );
    } catch {
      /* ignore */
    }
  };

  const confirm = async () => {
    if (busy) return;
    // Web: the seed must be sealed behind a PIN/passkey before it touches disk, so
    // route through the lock-setup screen instead of persisting here.
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
      header={
        <AppBar
          title="Backup seed"
          subtitle="Step 2 of 2"
          onBack={() => router.back()}
          right={<IconButton name="x" onPress={() => router.back()} accessibilityLabel="Cancel" />}
        />
      }
      footer={
        <View style={styles.footer}>
          <Button
            label={busy ? 'Creating identity…' : "I've written it down  →"}
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
      <Txt variant="body" tone="inkSoft">
        Write these 12 words down somewhere private. They&apos;re the{' '}
        <Txt variant="body" weight="bold" tone="ink">
          only
        </Txt>{' '}
        way to recover your account.
      </Txt>

      <SeedGrid words={words} concealed={!revealed} />

      <View style={styles.actions}>
        <Button
          label={revealed ? 'Hide' : 'Reveal'}
          variant="ghost"
          size="sm"
          iconName={revealed ? 'eye-off' : 'eye'}
          onPress={() => setRevealed((v) => !v)}
        />
        {Platform.OS === 'web' ? (
          <Button label="Copy" variant="ghost" size="sm" iconName="copy" onPress={copy} />
        ) : null}
      </View>

      {error ? (
        <Callout tone="danger" iconName="alert" title="Couldn't create identity">
          {error}
        </Callout>
      ) : (
        <Callout tone="danger" iconName="alert" title="No screenshots.">
          Anyone with these 12 words can read your messages forever.
        </Callout>
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
  footer: { paddingHorizontal: spacing.screenX, paddingTop: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
