import { useMemo, useState } from 'react';
import { Redirect, router } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { AppBar } from '@/components/ui/AppBar';
import { Callout } from '@/components/ui/Callout';
import { IconButton } from '@/components/ui/IconButton';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';
import { SeedBackup } from '@/components/onboarding/SeedBackup';
import { SeedUnlock } from '@/components/onboarding/SeedUnlock';

/** View / back up the active account's recovery seed. Web gates the reveal behind a
 *  fresh PIN/passkey check (the seed is only pulled into state after it passes);
 *  native has no app-lock, so it shows straight away (concealed-by-default).
 *  Nostr-derived accounts have no seed at all — show an explanation instead. */
export default function BackupSeedScreen() {
  const { session, getActiveSeed, lockMethods, verifyLock, activeBootstrapOrigin } = useSession();
  const gated = Platform.OS === 'web';
  const [seed, setSeed] = useState<string[] | null>(() => (gated ? null : getActiveSeed()));
  const methods = useMemo(() => lockMethods(), [lockMethods]);
  const nostrLinked = activeBootstrapOrigin?.kind === 'secp256k1';

  // Reached without an unlocked vault — nothing to do here. Nostr accounts have no
  // seed, so the no-gate-no-seed early redirect from the seed-only flow doesn't fit
  // them; they bypass it and render the explanatory Callout below.
  if (!session) return <Redirect href="/" />;
  if (!gated && !seed && !nostrLinked) return <Redirect href="/" />;

  return (
    <StackScreen
      scroll
      contentStyle={styles.content}
      header={
        <AppBar
          title="Recovery seed"
          subtitle={nostrLinked ? 'Linked to Nostr' : seed ? 'Back up this account' : 'Confirm it’s you'}
          onBack={() => router.back()}
          right={<IconButton name="x" onPress={() => router.back()} accessibilityLabel="Close" />}
        />
      }
    >
      {nostrLinked ? (
        <Callout tone="info" iconName="key" title="No recovery seed for this account">
          <Txt variant="body" tone="inkSoft">
            This account was created from your Nostr extension. To recover or sign in on another
            device, use the same Nostr key with “Login with Nostr extension”.
          </Txt>
        </Callout>
      ) : seed ? (
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
