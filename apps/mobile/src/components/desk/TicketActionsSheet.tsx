import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { StatusPill } from './StatusPill';
import type { TicketEntry } from '@/lib/use-tickets';
import type { TicketStatus } from '@drakkar.software/octochat-sdk';

const STATUSES: TicketStatus[] = ['open', 'pending', 'solved', 'closed'];

interface TicketActionsSheetProps {
  visible: boolean;
  /** The ticket being acted on (null when the sheet is closed). */
  entry: TicketEntry | null;
  onSetStatus: (status: TicketStatus) => void;
  onArchive: () => void;
  onClose: () => void;
}

/**
 * Bottom-sheet action menu for a single ticket, opened via long-press on a
 * {@link TicketRow} or the header button in the ticket's room view. Offers a
 * full status picker (Open / Pending / Solved / Closed, current one check-marked)
 * and an Archive action. Modeled on {@link DmActionsSheet}.
 */
export function TicketActionsSheet({ visible, entry, onSetStatus, onArchive, onClose }: TicketActionsSheetProps) {
  const { colors } = useTheme();
  if (!entry) return null;

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
            {entry.node.title}
          </Txt>
          {/* Status picker — four rows, one per status, trailing check on the current. */}
          <View style={styles.list}>
            {STATUSES.map((s) => (
              <Pressable
                key={s}
                accessibilityRole="button"
                onPress={() => { onSetStatus(s); onClose(); }}
                style={({ pressed }) => [styles.option, { backgroundColor: pressed ? colors.hover : 'transparent' }]}
              >
                <StatusPill status={s} />
                <View style={styles.optionSpacer} />
                {entry.ticket.status === s ? <Icon name="check" size={15} color={colors.inkMuted} /> : null}
              </Pressable>
            ))}
          </View>
          {/* Separator between status picker and destructive archive action. */}
          <View style={[styles.separator, { backgroundColor: colors.lineFaint }]} />
          <View style={styles.list}>
            <Pressable
              accessibilityRole="button"
              onPress={() => { onArchive(); onClose(); }}
              style={({ pressed }) => [styles.option, { backgroundColor: pressed ? colors.hover : 'transparent' }]}
            >
              <Icon name="archive" size={15} color={colors.inkMuted} />
              <Txt variant="subhead" numberOfLines={1} style={styles.optionLabel}>
                Archive ticket
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
  optionSpacer: { flex: 1 },
  optionLabel: { flex: 1 },
  separator: { height: 1, marginHorizontal: spacing.lg, marginVertical: spacing.sm },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  cancel: { alignItems: 'center', paddingVertical: spacing.sm },
});
