import { useMemo, useState } from 'react';
import { Redirect, router } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { AppBar } from '@/components/ui/AppBar';
import { IconButton } from '@/components/ui/IconButton';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';
import { SeedBackup } from '@/components/onboarding/SeedBackup';
import { SeedUnlock } from '@/components/onboarding/SeedUnlock';

/** View / back up the active account's recovery seed. Web gates the reveal behind a
 *  fresh PIN/passkey check (the seed is only pulled into state after it passes);
 *  native has no app-lock, so it shows straight away (concealed-by-default). */
export default function BackupSeedScreen() {
  const { session, getActiveSeed, lockMethods, verifyLock } = useSession();
  const gated = Platform.OS === 'web';
  const [seed, setSeed] = useState<string[] | null>(() => (gated ? null : getActiveSeed()));
  const methods = useMemo(() => lockMethods(), [lockMethods]);

  // Reached without an unlocked vault, or no seed to reveal and no gate to show
  // (native edge: a stale activeId) — nothing to do here.
  if (!session || (!gated && !seed)) return <Redirect href="/" />;

  return (
    <StackScreen
      scroll
      contentStyle={styles.content}
      header={
        <AppBar
          title="Recovery seed"
          subtitle={seed ? 'Back up this account' : 'Confirm it’s you'}
          onBack={() => router.back()}
          right={<IconButton name="x" onPress={() => router.back()} accessibilityLabel="Close" />}
        />
      }
    >
      {seed ? (
        <SeedBackup
          words={seed}
          intro={
            <Txt variant="body" tone="inkSoft">
              These 12 words restore this account on any device. Keep them private and offline.
            </Txt>
          }
        />
      ) : (
        <>
          <Txt variant="body" tone="inkSoft">
            Enter your PIN or use your passkey to reveal this account’s recovery seed.
          </Txt>
          <SeedUnlock
            methods={methods}
            onUnlock={verifyLock}
            onDone={() => {
              // Pull the seed only after a passing re-auth. Bail out rather than stick on
              // the gate if there's somehow nothing to show (vault emptied mid-flow).
              const s = getActiveSeed();
              if (s) setSeed(s);
              else router.back();
            }}
          />
        </>
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.screenX, gap: spacing.lg },
});
