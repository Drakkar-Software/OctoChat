import { Modal, Pressable, StyleSheet } from 'react-native';

import { layout, spacing } from '@/theme';
import { Card } from '@/components/ui/Card';

import { AccountSwitcher } from './AccountSwitcher';

interface AccountSwitcherPopoverProps {
  visible: boolean;
  onClose: () => void;
  /** "Profile & settings" target (the desktop rail's only path to the profile screen). */
  onViewProfile?: () => void;
}

/**
 * The {@link AccountSwitcher} floated above the desktop spaces-rail foot. A
 * full-screen transparent backdrop closes it on an outside tap / Escape (Modal);
 * the card itself swallows taps so they don't dismiss it.
 */
export function AccountSwitcherPopover({ visible, onClose, onViewProfile }: AccountSwitcherPopoverProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close account menu">
        <Pressable style={styles.anchor} onPress={() => {}}>
          <Card style={styles.card}>
            <AccountSwitcher onRequestClose={onClose} onViewProfile={onViewProfile} />
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  // Anchored just right of the rail, floating above the foot avatar.
  anchor: { position: 'absolute', left: layout.railWidth + spacing.xs, bottom: spacing.lg, width: 264 },
  card: { padding: spacing.md },
});
