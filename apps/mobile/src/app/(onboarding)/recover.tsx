import { useState } from 'react';
import { router } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { isValidSeed } from '@/lib/starfish/identity';
import { useSession } from '@/lib/session-context';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { StackScreen } from '@/components/ui/StackScreen';
import { TextField } from '@/components/ui/TextField';
import { Txt } from '@/components/ui/Txt';

export default function RecoverScreen() {
  const { signIn, prepareSignIn, addAccount, session } = useSession();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restore = async () => {
    const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length !== 12) {
      setError('Enter all 12 words, separated by spaces.');
      return;
    }
    if (!isValidSeed(words)) {
      setError('That is not a valid 12-word recovery seed.');
      return;
    }
    // Adding to an already-unlocked vault: append under the existing app-lock, no
    // PIN step. (A live session means we're signed in and adding another account.)
    if (session) {
      setBusy(true);
      setError(null);
      try {
        await addAccount(words);
        router.replace('/(tabs)/rooms');
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
        setBusy(false);
      }
      return;
    }
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
      <Txt variant="body" tone="inkSoft">
        Type your 12 recovery words, separated by spaces. The same words restore the same identity.
      </Txt>
      <TextField
        value={text}
        onChangeText={setText}
        placeholder="anchor bluefin coral …"
        mono
        multiline
        minHeight={88}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button label={busy ? 'Recovering…' : 'Recover'} variant="primary" size="lg" full loading={busy} disabled={busy} onPress={restore} />
      {error ? (
        <Callout tone="danger" iconName="alert">
          {error}
        </Callout>
      ) : null}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
});
