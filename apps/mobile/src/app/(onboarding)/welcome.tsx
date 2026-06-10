import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { spacing, type } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { useSession } from '@/lib/session-context';
import { hasNostrSignSchnorr, loginWithNostrExtension } from '@drakkar.software/octochat-sdk';
import { HeroMark } from '@/components/brand/HeroMark';
import { Wordmark } from '@/components/brand/Wordmark';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Divider } from '@/components/ui/Divider';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { StaggerList } from '@/components/ui/StaggerList';
import { Txt } from '@/components/ui/Txt';

export default function Welcome() {
  const { colors } = useTheme();
  const { prepareNostrSignIn } = useSession();
  // NIP-07 extensions inject `window.nostr` from their content script. Timing is
  // not guaranteed against React mount, so probe at mount AND on tab focus — and
  // only render the button once we've actually seen the provider.
  const [nostrAvailable, setNostrAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const probe = () => setNostrAvailable(hasNostrSignSchnorr());
    probe();
    const t = setTimeout(probe, 250);
    window.addEventListener('focus', probe);
    return () => {
      clearTimeout(t);
      window.removeEventListener('focus', probe);
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onNostrLogin = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const root = await loginWithNostrExtension();
      prepareNostrSignIn(root);
      router.push('/(onboarding)/lock');
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setBusy(false);
    }
  };

  return (
    <Screen style={styles.screen}>
      <StaggerList style={styles.hero}>
        <HeroMark size={128} />
        <Wordmark hideMark size={type.displayLg.fontSize} />
        <Txt variant="subhead" weight="medium" tone="inkSoft" center>
          <Txt variant="subhead" weight="semibold" tone="accent">
            End-to-end encrypted
          </Txt>
          {'\n'}team chat by design.
        </Txt>
      </StaggerList>

      <StaggerList style={styles.actions}>
        <Button
          label="Create new identity"
          variant="primary"
          size="lg"
          full
          onPress={() => router.push('/(onboarding)/seed')}
        />

        <View style={styles.altGroup}>
          <View style={styles.altLabel}>
            <Divider style={styles.altRule} />
            <Txt variant="caption" mono uppercase tone="inkMuted">
              Already have an identity
            </Txt>
            <Divider style={styles.altRule} />
          </View>
          <Button
            label="I have a recovery seed"
            variant="secondary"
            size="md"
            full
            iconName="key"
            onPress={() => router.push('/(onboarding)/recover')}
          />
          <Button
            label="Scan QR from existing device"
            variant="ghost"
            size="md"
            full
            iconName="qr"
            onPress={() => router.push('/pair')}
          />
          {nostrAvailable ? (
            <>
              <Button
                label="Login with Nostr extension"
                variant="ghost"
                size="md"
                full
                iconName="key"
                loading={busy}
                onPress={onNostrLogin}
              />
              {error ? (
                <Callout tone="danger" iconName="alert" title="Couldn't sign in with Nostr">
                  {error}
                </Callout>
              ) : (
                <Callout tone="warning" iconName="key" title="Use a deterministic signer">
                  Sign in with a deterministic NIP-07 extension (nos2x, Alby) — a randomized signer would lock you out on
                  reinstall.
                </Callout>
              )}
            </>
          ) : null}
        </View>

        <View style={styles.trust}>
          <Icon name="lock" size={12} color={colors.accent} />
          <Txt variant="caption" tone="inkMuted">
            No email, no phone, no password.
          </Txt>
        </View>
      </StaggerList>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingHorizontal: spacing.xl,
    justifyContent: 'space-between',
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  actions: {
    gap: spacing.lg,
  },
  altGroup: {
    gap: spacing.md,
  },
  altLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  altRule: {
    flex: 1,
  },
  trust: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
