import { useEffect, useState } from 'react';
import { Redirect, router } from 'expo-router';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { copyText } from '@/lib/clipboard';
import { startDevicePairing } from '@/lib/starfish/pairing';
import { useSession } from '@/lib/session-context';
import { successFeedback } from '@/lib/haptics';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { IconButton } from '@/components/ui/IconButton';
import { Pill } from '@/components/ui/Pill';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';
import { PinDots } from '@/components/onboarding/PinDots';
import { PinPad } from '@/components/onboarding/PinPad';
import { QrCode } from '@/components/onboarding/QrCode';

const PIN_LENGTH = 6;

/** Step 1: confirm device PIN → Step 2: a real, PIN-sealed pairing QR to scan.
 *  Lives under `account/` (not `(onboarding)/`) — entered only from settings on
 *  an already-unlocked vault, so it must not be gated by the onboarding stack. */
export default function AddDeviceScreen() {
  const { session } = useSession();
  const [pin, setPin] = useState('');
  const [stage, setStage] = useState<'pin' | 'qr'>('pin');
  const [payload, setPayload] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pin.length !== PIN_LENGTH || !session) return;
    let cancelled = false;
    successFeedback();
    (async () => {
      try {
        const qr = await startDevicePairing(session, pin);
        if (!cancelled) {
          setPayload(qr);
          setStage('qr');
        }
      } catch (e) {
        if (!cancelled) {
          setError(String((e as Error)?.message ?? e));
          setPin('');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pin, session]);

  // Settings-only flow: bail to the root (which redirects to onboarding) if we
  // somehow land here without an unlocked vault.
  if (!session) return <Redirect href="/" />;

  const fingerprint = session.fingerprint;
  const close = () => router.back();

  if (stage === 'pin') {
    return (
      <StackScreen
        contentStyle={styles.pinContent}
        header={
          <AppBar
            title="Add a device"
            subtitle="Step 1 of 2 · this device"
            onBack={() => router.back()}
            right={<IconButton name="x" onPress={close} accessibilityLabel="Cancel" />}
          />
        }
      >
        <Callout tone="accent" iconName="shield">
          Confirm with your device PIN. It encrypts the pairing code so it&apos;s useless without the PIN.
        </Callout>

        <View style={styles.pinBlock}>
          <Txt variant="caption" weight="semibold" mono uppercase tone="inkSoft" center>
            Enter PIN
          </Txt>
          <PinDots length={PIN_LENGTH} filled={pin.length} />
        </View>

        {error ? (
          <Callout tone="danger" iconName="alert">
            {error}
          </Callout>
        ) : null}

        <PinPad
          onDigit={(d) => setPin((p) => (p.length < PIN_LENGTH ? p + d : p))}
          onDelete={() => setPin((p) => p.slice(0, -1))}
        />
      </StackScreen>
    );
  }

  return (
    <StackScreen
      contentStyle={styles.qrContent}
      header={
        <AppBar
          title="Scan from new device"
          subtitle="Step 2 of 2"
          onBack={() => {
            setPin('');
            setPayload(null);
            setStage('pin');
          }}
          right={<IconButton name="x" onPress={close} accessibilityLabel="Cancel" />}
        />
      }
      footer={
        <View style={styles.footer}>
          <Button label="Done" variant="primary" size="lg" full onPress={close} />
        </View>
      }
    >
      <Txt variant="callout" tone="inkSoft" center>
        On the new device, choose{' '}
        <Txt variant="callout" weight="bold" tone="ink">
          Scan QR from existing device
        </Txt>{' '}
        and scan this — then enter the same PIN.
      </Txt>

      {payload ? <QrCode size={240} value={payload} /> : null}

      <View style={styles.statusRow}>
        <Pill tone="accent" label="WAITING FOR SCAN…" mono />
        {Platform.OS === 'web' && payload ? (
          <Pressable onPress={() => copyText(payload)} accessibilityRole="button">
            <Txt variant="micro" mono tone="accent">
              COPY CODE
            </Txt>
          </Pressable>
        ) : null}
      </View>

      <Callout tone="info" iconName="key">
        Fingerprint {fingerprint} — verify it matches on both devices.
      </Callout>
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  // Centered narrow column so the PIN pad doesn't blow up to the full desktop
  // pane width (the onboarding screens hit this naturally via the pre-shell
  // layout; here we're inside the desktop shell as a signed-in user).
  pinContent: {
    padding: spacing.screenX,
    gap: spacing.xl,
    justifyContent: 'center',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 360,
  },
  pinBlock: { gap: spacing.md },
  qrContent: { padding: spacing.screenX, gap: spacing.xl, alignItems: 'center', justifyContent: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  footer: { paddingHorizontal: spacing.screenX, paddingTop: spacing.md },
});
