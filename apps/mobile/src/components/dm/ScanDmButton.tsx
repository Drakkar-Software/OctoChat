import { Modal, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing } from '@/theme';
import { useDmScan } from '@/lib/use-dm-scan';
import { useTheme } from '@/lib/use-theme';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { IconButton } from '@/components/ui/IconButton';
import { ProfileHero } from '@/components/ui/ProfileHero';
import { QrScanner } from '@/components/onboarding/QrScanner';
import { Txt } from '@/components/ui/Txt';

/**
 * Header action that opens the camera to scan someone's DM QR — the inverse of
 * {@link ShareDmButton}. Point it at a DM QR to open an E2EE DM with no space in
 * common. Camera scanning is native-only (web has no `QrScanner`), so the icon
 * simply isn't rendered on web. All flow logic lives in {@link useDmScan}; this
 * is the thin trigger + camera/confirm surface over it.
 */
export function ScanDmButton() {
  if (Platform.OS === 'web') return null;
  return <ScanDmButtonNative />;
}

function ScanDmButtonNative() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const scan = useDmScan();

  return (
    <>
      <IconButton name="qr-scan" accessibilityLabel="Scan a DM code" onPress={scan.open} />

      <Modal visible={scan.phase !== 'idle'} animationType="slide" onRequestClose={scan.cancel}>
        <View style={[styles.sheet, { backgroundColor: colors.canvas, paddingTop: insets.top + spacing.sm }]}>
          <View style={styles.head}>
            <Txt variant="heading" weight="bold">
              Scan a DM code
            </Txt>
            <IconButton name="x" accessibilityLabel="Close scanner" onPress={scan.cancel} />
          </View>

          {scan.phase === 'scanning' ? (
            <View style={styles.body}>
              <QrScanner onScan={scan.scan} />
              <Txt variant="footnote" tone="inkMuted" center>
                Point your camera at someone’s DM QR to start an encrypted conversation.
              </Txt>
            </View>
          ) : (
            <View style={styles.body}>
              {scan.verified === false ? (
                <Callout tone="danger" iconName="alert" title="Invalid DM code">
                  This code’s identity doesn’t check out — its keys don’t match its address. Ask for a fresh one.
                </Callout>
              ) : scan.token && scan.verified === null ? (
                <Txt variant="footnote" tone="inkMuted" center>
                  Checking code…
                </Txt>
              ) : scan.token ? (
                <>
                  <ProfileHero name={scan.name} handle={scan.handle} avatarLabel={scan.name.slice(0, 2).toUpperCase()} />
                  {scan.isSelf ? (
                    <Callout tone="info" iconName="dm" title="That’s your own DM code">
                      Share it with others so they can message you.
                    </Callout>
                  ) : (
                    <Button
                      label={scan.phase === 'starting' ? 'Starting…' : `Message ${scan.name}`}
                      iconName="dm"
                      variant="primary"
                      size="lg"
                      full
                      loading={scan.phase === 'starting'}
                      onPress={() => void scan.start()}
                    />
                  )}
                </>
              ) : null}

              {scan.error ? (
                <Callout tone="danger" iconName="alert">
                  {scan.error}
                </Callout>
              ) : null}

              <Button label="Scan again" variant="secondary" size="md" iconName="qr-scan" full onPress={scan.open} />
            </View>
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingHorizontal: spacing.screenX, paddingBottom: spacing.xl, gap: spacing.lg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  body: { gap: spacing.lg },
});
