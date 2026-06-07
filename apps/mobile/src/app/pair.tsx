import { useState } from 'react';
import { router } from 'expo-router';
import { Platform, StyleSheet, TextInput, View } from 'react-native';

import { fonts, radii, spacing, type as typeScale } from '@/theme';
import { completeDevicePairing, type PairResult } from '@drakkar.software/octochat-sdk';
import { useSession } from '@/lib/session-context';
import { useTheme } from '@/lib/use-theme';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';
import { QrScanner } from '@/components/onboarding/QrScanner';
import { SeedLockSetup } from '@/components/onboarding/SeedLockSetup';

export default function PairScreen() {
  const { colors } = useTheme();
  const { addLinkedDevice, session, passkeyAvailable } = useSession();
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PairResult | null>(null);

  const pair = async (payload?: string) => {
    const c = (payload ?? code).trim();
    if (!c || pin.length < 1 || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await completeDevicePairing(c, pin));
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const linked = { userId: result.userId, keys: result.deviceKeys, capCert: result.capCert };
    // A signed-out web device must set an app-lock (PIN) before its vault can be
    // sealed. Native (Keychain) and an already-unlocked web vault add without one.
    const needsLock = Platform.OS === 'web' && !session;
    return (
      <StackScreen
        scroll={needsLock}
        contentStyle={needsLock ? styles.content : styles.center}
        header={<AppBar title="Device paired" onBack={() => router.back()} />}
      >
        <Pill tone="success" label="VERIFIED ✓" mono />
        <Txt variant="title" weight="bold" center>
          Fingerprint matches
        </Txt>
        <Txt variant="callout" mono tone="inkSoft" center>
          {result.fingerprint}
        </Txt>
        <Callout tone="info" iconName="shield">
          Pairing validated for identity {result.userId.slice(0, 8)}…. Your owned spaces
          are ready on this device; spaces you only joined need a re-invite from their
          owner.
        </Callout>
        {error ? (
          <Callout tone="danger" iconName="alert">
            {error}
          </Callout>
        ) : null}
        {needsLock ? (
          <SeedLockSetup
            passkeyAvailable={passkeyAvailable}
            onSubmit={(lock) => addLinkedDevice(linked, undefined, lock)}
            onDone={() => router.replace('/(tabs)/rooms')}
          />
        ) : (
          <Button
            label={adding ? 'Adding…' : 'Add this device'}
            variant="primary"
            size="lg"
            full
            loading={adding}
            disabled={adding}
            onPress={async () => {
              setAdding(true);
              setError(null);
              try {
                await addLinkedDevice(linked);
                router.replace('/(tabs)/rooms');
              } catch (e) {
                setError(String((e as Error)?.message ?? e));
                setAdding(false);
              }
            }}
          />
        )}
      </StackScreen>
    );
  }

  const input = (value: string, set: (v: string) => void, placeholder: string, secure = false) => (
    <TextInput
      value={value}
      onChangeText={set}
      placeholder={placeholder}
      placeholderTextColor={colors.inkMuted}
      underlineColorAndroid="transparent"
      style={[styles.input, { color: colors.ink, backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}
      autoCapitalize="none"
      autoCorrect={false}
      secureTextEntry={secure}
      keyboardType={secure ? 'number-pad' : 'default'}
    />
  );

  return (
    <StackScreen
      scroll
      contentStyle={styles.content}
      header={<AppBar title="Scan QR from existing device" subtitle="step 2 of 2 · new device" onBack={() => router.back()} />}
    >
      {Platform.OS !== 'web' ? <QrScanner onScan={(d) => setCode(d)} /> : null}

      <Card title="PAIRING CODE">
        <Txt variant="footnote" tone="inkSoft">
          {Platform.OS === 'web'
            ? 'Paste the code shown under the QR on your existing device.'
            : 'Scan the QR above, or paste the code.'}
        </Txt>
        {input(code, setCode, 'octochat-pair:…')}
      </Card>

      <Card title="DEVICE PIN">{input(pin, setPin, 'Enter the PIN', true)}</Card>

      <Button label={busy ? 'Pairing…' : 'Pair device'} variant="primary" size="lg" full disabled={busy} onPress={() => pair()} />
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
  center: { padding: spacing.xl, gap: spacing.md, alignItems: 'center', justifyContent: 'center' },
  input: {
    height: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.mono,
    fontSize: typeScale.footnote.fontSize,
    includeFontPadding: false,
  },
});
