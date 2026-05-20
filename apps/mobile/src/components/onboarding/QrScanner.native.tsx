import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { radii } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Button } from '@/components/ui/Button';
import { Txt } from '@/components/ui/Txt';

/** Native camera QR scanner — fires onScan once with the decoded payload. */
export function QrScanner({ onScan }: { onScan: (data: string) => void }) {
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const fired = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  if (!permission?.granted) {
    return (
      <View style={[styles.box, styles.center, { backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}>
        <Txt variant="footnote" tone="inkSoft" center>
          Camera access is needed to scan the pairing QR.
        </Txt>
        <Button label="Grant camera" variant="secondary" size="sm" onPress={() => requestPermission()} />
      </View>
    );
  }

  return (
    <View style={[styles.box, { borderColor: colors.accent }]}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (fired.current) return;
          fired.current = true;
          onScan(data);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { height: 240, borderRadius: radii.lg, borderWidth: 2, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16 },
});
