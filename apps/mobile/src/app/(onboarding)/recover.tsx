import { useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, TextInput } from 'react-native';

import { fonts, radii, spacing, type as typeScale } from '@/theme';
import { isValidSeed } from '@/lib/starfish/identity';
import { useSession } from '@/lib/session-context';
import { useTheme } from '@/lib/use-theme';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';

export default function RecoverScreen() {
  const { colors } = useTheme();
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
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="anchor bluefin coral …"
        placeholderTextColor={colors.inkMuted}
        style={[styles.input, { color: colors.ink, backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button label={busy ? 'Recovering…' : 'Recover'} variant="primary" size="lg" full disabled={busy} onPress={restore} />
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
  input: {
    minHeight: 88,
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.md,
    fontFamily: fonts.mono,
    fontSize: typeScale.footnote.fontSize,
    textAlignVertical: 'top',
  },
});
