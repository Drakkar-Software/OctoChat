import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import type { Room } from '@drakkar.software/octochat-sdk';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface MoveToCategorySheetProps {
  visible: boolean;
  /** The room being moved (null when closed). Its current category is excluded. */
  room: Room | null;
  /** All category names in the space. */
  categories: string[];
  onSelect: (category: string) => void;
  onClose: () => void;
}

/** Bottom-sheet picker that re-homes a channel to another category — the native
 *  equivalent of dragging the row onto a category header (also the web fallback if
 *  element drag is unavailable). Built on RN `Modal` like {@link Lightbox}. */
export function MoveToCategorySheet({ visible, room, categories, onSelect, onClose }: MoveToCategorySheetProps) {
  const { colors } = useTheme();
  const options = categories.filter((c) => c !== room?.category);

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
            Move {room ? `#${room.name}` : 'channel'} to…
          </Txt>
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {options.length === 0 ? (
              <Txt variant="footnote" tone="inkMuted" style={styles.empty}>
                No other categories yet. Create one in space settings.
              </Txt>
            ) : (
              options.map((c) => (
                <Pressable
                  key={c}
                  accessibilityRole="button"
                  onPress={() => {
                    onSelect(c);
                    onClose();
                  }}
                  style={({ pressed }) => [styles.option, { backgroundColor: pressed ? colors.hover : 'transparent' }]}
                >
                  <Icon name="folder" size={15} color={colors.inkMuted} />
                  <Txt variant="subhead" numberOfLines={1} style={styles.optionLabel}>
                    {c}
                  </Txt>
                </Pressable>
              ))
            )}
          </ScrollView>
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
    maxHeight: '70%',
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
  },
  title: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  list: { paddingHorizontal: spacing.sm },
  empty: { padding: spacing.lg },
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
