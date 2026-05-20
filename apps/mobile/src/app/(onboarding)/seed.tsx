import { useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { SEED_WORDS } from '@/lib/placeholder-data';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { IconButton } from '@/components/ui/IconButton';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';
import { SeedGrid } from '@/components/onboarding/SeedGrid';

export default function SeedScreen() {
  const [revealed, setRevealed] = useState(false);

  return (
    <StackScreen
      scroll
      contentStyle={styles.content}
      header={
        <AppBar
          title="Backup seed"
          subtitle="Step 2 of 3"
          onBack={() => router.back()}
          right={
            <IconButton name="x" onPress={() => router.replace('/(tabs)/rooms')} accessibilityLabel="Skip" />
          }
        />
      }
      footer={
        <View style={styles.footer}>
          <Button
            label="I've written it down  →"
            variant="primary"
            size="lg"
            full
            onPress={() => router.push('/(onboarding)/add-device')}
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

      <SeedGrid words={SEED_WORDS} concealed={!revealed} />

      <View style={styles.actions}>
        <Button
          label={revealed ? 'Hide' : 'Reveal'}
          variant="ghost"
          size="sm"
          iconName={revealed ? 'eye-off' : 'eye'}
          onPress={() => setRevealed((v) => !v)}
        />
        <Button label="Copy" variant="ghost" size="sm" iconName="copy" />
        <Button label="Save to keychain" variant="ghost" size="sm" iconName="key" />
      </View>

      <Callout tone="danger" iconName="alert" title="No screenshots.">
        Anyone with these 12 words can read your messages forever.
      </Callout>
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
  footer: { paddingHorizontal: spacing.screenX, paddingTop: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
