import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import type { DmEntry } from '@/lib/use-dms';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface DmActionsSheetProps {
  visible: boolean;
  /** The DM entry being acted on (null when the sheet is closed). */
  dm: DmEntry | null;
  onArchive: (dm: DmEntry) => void;
  onUnarchive: (dm: DmEntry) => void;
  onClose: () => void;
}

/**
 * Bottom-sheet action menu for a single Direct Message conversation, opened via
 * long-press on a {@link DmList} row (or the web right-click equivalent). Currently
 * offers a single action: archive or unarchive. Built on RN `Modal` like
 * {@link MoveToCategorySheet} so it works identically on native and web.
 */
export function DmActionsSheet({ visible, dm, onArchive, onUnarchive, onClose }: DmActionsSheetProps) {
  const { colors } = useTheme();
  if (!dm) return null;

  const handleAction = () => {
    if (dm.archived) {
      onUnarchive(dm);
    } else {
      onArchive(dm);
    }
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.scrim }]}
        onPress={onClose}
        accessibilityLabel="Dismiss"
      >
        {/* Inner press swallows taps so they don't fall through to the backdrop. */}
        <Pressable style={[styles.sheet, { backgroundColor: colors.paper }]} onPress={() => undefined}>
          <Txt variant="micro" weight="bold" mono uppercase tone="inkMuted" style={styles.title}>
            {dm.name}
          </Txt>
          <View style={styles.list}>
            <Pressable
              accessibilityRole="button"
              onPress={handleAction}
              style={({ pressed }) => [styles.option, { backgroundColor: pressed ? colors.hover : 'transparent' }]}
            >
              <Icon name="archive" size={15} color={colors.inkMuted} />
              <Txt variant="subhead" numberOfLines={1} style={styles.optionLabel}>
                {dm.archived ? 'Unarchive conversation' : 'Archive conversation'}
              </Txt>
            </Pressable>
          </View>
          <View style={styles.footer}>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.cancel}>
              <Txt variant="subhead" weight="semibold" tone="inkMuted">
                Cancel
              </Txt>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
  },
  title: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  list: { paddingHorizontal: spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
  },
  optionLabel: { flex: 1 },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  cancel: { alignItems: 'center', paddingVertical: spacing.sm },
});
