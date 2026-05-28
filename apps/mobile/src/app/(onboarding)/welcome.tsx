import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { useSession } from '@/lib/session-context';
import { hasNostrSignSchnorr, loginWithNostrExtension } from '@/lib/nostr';
import { HeroMark } from '@/components/brand/HeroMark';
import { Wordmark } from '@/components/brand/Wordmark';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
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
      <View style={styles.hero}>
        <HeroMark size={128} />
        <View style={styles.lockup}>
          <Wordmark hideMark size={32} />
          <Txt variant="subhead" weight="medium" tone="inkSoft" center>
            End-to-end encrypted{'\n'}team chat by design.
          </Txt>
        </View>
      </View>

      <View style={styles.actions}>
        <Button
          label="Create new identity"
          variant="primary"
          size="lg"
          full
          onPress={() => router.push('/(onboarding)/seed')}
        />
        <Button
          label="I have a recovery seed"
          variant="secondary"
          size="lg"
          full
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
              <Txt variant="footnote" tone="danger" center>
                {error}
              </Txt>
            ) : (
              <Txt variant="caption" tone="inkMuted" center>
                Use a deterministic NIP-07 extension (nos2x, Alby) — a randomized signer would lock you out on reinstall.
              </Txt>
            )}
          </>
        ) : null}

        <Divider style={styles.rule} />
        <View style={styles.trust}>
          <Icon name="lock" size={12} color={colors.accent} />
          <Txt variant="caption" tone="inkMuted">
            No email, no phone, no password.
          </Txt>
        </View>
      </View>
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
    gap: spacing.xxl,
  },
  lockup: {
    alignItems: 'center',
    gap: spacing.md,
  },
  actions: {
    gap: spacing.md,
  },
  rule: {
    marginTop: spacing.sm,
  },
  trust: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
