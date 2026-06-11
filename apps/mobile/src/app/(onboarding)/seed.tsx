import { useMemo } from 'react';
import { Redirect, router } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { generateSeedWords } from '@drakkar.software/octochat-sdk';
import { useSession } from '@/lib/session-context';
import { useTheme } from '@/lib/use-theme';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';
import { SeedBackup } from '@/components/onboarding/SeedBackup';

const TOTAL_STEPS = 2;

/** Two-segment progress for the create-identity ceremony (this is its final step). */
function StepDots({ step, total }: { step: number; total: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.steps}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[styles.segment, { backgroundColor: i < step ? colors.accent : colors.lineSoft }]}
        />
      ))}
    </View>
  );
}

export default function SeedScreen() {
  const { prepareSignIn, session } = useSession();
  const words = useMemo(() => generateSeedWords(), []);

  // Already signed in: this screen creates the FIRST account, so running signIn here
  // would replace the whole vault. Adding accounts goes through /account/* instead.
  if (session) return <Redirect href="/(tabs)/rooms" />;

  const confirm = () => {
    prepareSignIn(words);
    // Web requires PIN/passkey setup before the seed touches disk.
    // Native delegates the slow Argon2 derivation to the creating screen.
    router.push(Platform.OS === 'web' ? '/(onboarding)/lock' : '/(onboarding)/creating');
  };

  return (
    <StackScreen
      scroll
      contentStyle={styles.content}
      header={
        <AppBar
          title="Backup seed"
          subtitle={<StepDots step={TOTAL_STEPS} total={TOTAL_STEPS} />}
          onBack={() => router.back()}
          right={<IconButton name="x" onPress={() => router.back()} accessibilityLabel="Cancel" />}
        />
      }
      footer={
        <View style={styles.footer}>
          <Button
            label="I've written it down  →"
            variant="primary"
            size="lg"
            full
            onPress={confirm}
          />
        </View>
      }
    >
      <SeedBackup
        words={words}
        intro={
          <View style={styles.intro}>
            <Txt variant="display" weight="bold">
              Your recovery phrase
            </Txt>
            <Txt variant="body" tone="inkSoft">
              Write these 12 words down somewhere private. They&apos;re the{' '}
              <Txt variant="body" weight="bold" tone="ink">
                only
              </Txt>{' '}
              way to recover your account.
            </Txt>
          </View>
        }
      />
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
  footer: { paddingHorizontal: spacing.screenX, paddingTop: spacing.md },
  steps: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  segment: { width: 20, height: 3, borderRadius: radii.xs },
  intro: { gap: spacing.sm },
});
