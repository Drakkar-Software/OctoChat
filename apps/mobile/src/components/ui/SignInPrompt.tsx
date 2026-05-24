import { useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';

import { Button } from './Button';
import { Callout } from './Callout';
import { EmptyState } from './EmptyState';

interface SignInPromptProps {
  /** Per-screen copy for the signed-out (no identity) case. Ignored when a sealed
   *  seed is waiting to be unlocked — that state has its own copy. */
  subtitle?: string;
}

/**
 * The "you need an identity to see this" placeholder, shared by every screen that
 * gates on a session. It resolves the session status into the right call to action:
 *
 *  - **locked + passkey** (web): the lock disc is tappable and unlocks in place via
 *    WebAuthn — handy when a deep link (e.g. `/room/:id`) lands on a locked tab and
 *    skips the `/` → unlock redirect. Unlocking here keeps the target URL.
 *  - **locked + PIN only** (web): route to the full unlock screen for the PIN pad.
 *  - **signed out** (no identity): route to onboarding to create or recover one.
 *
 * Locked states only occur on web (native restores from the OS keystore, so its
 * status is never 'locked'); native therefore only ever hits the signed-out branch.
 */
export function SignInPrompt({ subtitle }: SignInPromptProps) {
  const { status, unlockMethods, unlock } = useSession();
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restoring on launch: render nothing rather than flash "Sign in first" before
  // the persisted session resolves (a refresh on any gated page would show it).
  if (status === 'loading') return null;

  if (status === 'locked') {
    if (unlockMethods.includes('passkey')) {
      // Call unlock() straight from the press handler: WebAuthn's get() needs the
      // user gesture, so nothing awaited may run before it. On success the session
      // flips to "ready" and this prompt unmounts (its parent gates on the session),
      // so there's nothing to navigate to — the page swaps to its own content.
      const onPasskey = () => {
        setUnlocking(true);
        setError(null);
        unlock('passkey').catch((e) => {
          setError(String((e as Error)?.message ?? e));
          setUnlocking(false);
        });
      };
      return (
        <EmptyState
          iconName={unlocking ? 'unlock' : 'lock'}
          title="Welcome back"
          subtitle="Tap the lock to unlock with your passkey."
          onIconPress={unlocking ? undefined : onPasskey}
        >
          <View style={styles.actions}>
            {error ? (
              <Callout tone="danger" iconName="alert">
                {error}
              </Callout>
            ) : null}
            <Button
              label="Use PIN instead"
              variant="ghost"
              disabled={unlocking}
              style={styles.cta}
              onPress={() => router.push('/(onboarding)/unlock')}
            />
          </View>
        </EmptyState>
      );
    }
    return (
      <EmptyState iconName="lock" title="Locked" subtitle="Enter your PIN to continue.">
        <Button
          label="Unlock"
          variant="primary"
          iconName="key"
          style={styles.cta}
          onPress={() => router.push('/(onboarding)/unlock')}
        />
      </EmptyState>
    );
  }

  return (
    <EmptyState iconName="lock" title="Sign in first" subtitle={subtitle}>
      <Button
        label="Sign in"
        variant="primary"
        iconName="key"
        style={styles.cta}
        onPress={() => router.push('/(onboarding)/welcome')}
      />
    </EmptyState>
  );
}

const styles = StyleSheet.create({
  actions: { alignItems: 'center', gap: spacing.md },
  cta: { alignSelf: 'center' },
});
