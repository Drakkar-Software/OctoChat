import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { FINGERPRINT } from '@/lib/placeholder-data';
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

/** Step 1: confirm device PIN → Step 2: present a full-screen QR to scan. */
export default function AddDeviceScreen() {
  const [pin, setPin] = useState('');
  const [stage, setStage] = useState<'pin' | 'qr'>('pin');

  useEffect(() => {
    if (pin.length === PIN_LENGTH) {
      successFeedback();
      const t = setTimeout(() => setStage('qr'), 260);
      return () => clearTimeout(t);
    }
  }, [pin]);

  const close = () => router.replace('/(tabs)/rooms');

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
          Confirm with your device PIN. The QR code will be valid for 2 minutes.
        </Callout>

        <View style={styles.pinBlock}>
          <Txt variant="caption" weight="semibold" mono uppercase tone="inkSoft" center>
            Enter PIN
          </Txt>
          <PinDots length={PIN_LENGTH} filled={pin.length} />
        </View>

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
        and point its camera here.
      </Txt>

      <QrCode size={240} />

      <View style={styles.statusRow}>
        <Pill tone="accent" label="WAITING FOR SCAN…" mono />
        <Txt variant="micro" mono tone="inkMuted">
          EXPIRES IN 1:54
        </Txt>
      </View>

      <Callout tone="info" iconName="key">
        Fingerprint {FINGERPRINT} — verify it matches on both devices.
      </Callout>
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  pinContent: { padding: spacing.screenX, gap: spacing.xl, justifyContent: 'center' },
  pinBlock: { gap: spacing.md },
  qrContent: { padding: spacing.screenX, gap: spacing.xl, alignItems: 'center', justifyContent: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  footer: { paddingHorizontal: spacing.screenX, paddingTop: spacing.md },
});
