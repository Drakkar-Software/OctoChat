import { useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

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
  const { signIn } = useSession();
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
