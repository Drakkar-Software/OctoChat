import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { paperBorder, radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

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
      <View style={[styles.denied, paperBorder(colors)]}>
        <EmptyState
          iconName="camera"
          title="Camera access needed"
          subtitle="Allow the camera to scan a pairing or invitation QR code."
          action={
            <Button label="Grant camera" variant="secondary" size="sm" iconName="camera" onPress={() => requestPermission()} />
          }
        />
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
  // Fixed height: the live CameraView fills via absoluteFill, so its parent must be sized.
  box: { height: 260, borderRadius: radii.lg, borderWidth: 2, overflow: 'hidden' },
  // The denied state sizes to EmptyState's own content (its wrap is flex + padded), so a
  // minHeight gives it presence without clipping the halo/title/action at a fixed height.
  denied: { minHeight: 240, borderRadius: radii.lg, borderWidth: 1, padding: spacing.sm },
});
