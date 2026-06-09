import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { IconButton } from './IconButton';

interface LightboxProps {
  visible: boolean;
  onClose: () => void;
  /** Centered content (e.g. a full-size image). */
  children: ReactNode;
  /** Close button label for screen readers. */
  closeLabel?: string;
  /** Optional save/share action rendered as a button in the bottom-right corner. */
  onDownload?: () => void;
  /** Accessible label for the download button. */
  downloadLabel?: string;
}

/** Full-screen scrim overlay that centers its content. Tapping the backdrop, the
 *  close button, the Escape key (web) or the hardware back (Android) dismisses it. */
export function Lightbox({ visible, onClose, children, closeLabel = 'Close preview', onDownload, downloadLabel = 'Save / Share' }: LightboxProps) {
  const { colors } = useTheme();

  // Web has no hardware back; close on Escape to match the native affordance.
  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.scrim }]} onPress={onClose} accessibilityLabel={closeLabel}>
        <View style={styles.content} pointerEvents="box-none">
          {children}
        </View>
        <IconButton name="x" size={26} color={colors.onScrim} onPress={onClose} accessibilityLabel={closeLabel} style={styles.close} />
        {onDownload ? (
          <IconButton name="share" size={26} color={colors.onScrim} onPress={onDownload} accessibilityLabel={downloadLabel} style={styles.download} />
        ) : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  content: { alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', top: spacing.xxl, right: spacing.lg },
  download: { position: 'absolute', bottom: spacing.xxl, right: spacing.lg },
});
