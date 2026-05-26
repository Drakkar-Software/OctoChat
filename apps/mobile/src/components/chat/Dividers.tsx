import { StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Txt } from '@/components/ui/Txt';

/** Centered date marker between message groups — a paper pill riding a hairline,
 *  so the day reads as a quiet sticky label over the subaqua depth. */
export function DateDivider({ date }: { date: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.dateRow}>
      <View style={[styles.line, { backgroundColor: colors.lineFaint }]} />
      <View style={[styles.pill, { backgroundColor: colors.paper, borderColor: colors.lineFaint }]}>
        <Txt variant="micro" weight="semibold" mono uppercase tone="inkMuted">
          {date}
        </Txt>
      </View>
      <View style={[styles.line, { backgroundColor: colors.lineFaint }]} />
    </View>
  );
}

/** "New messages" marker — an accent rule trailed by an accent-tinted pill. */
export function UnreadDivider({ label = 'New' }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.unreadRow}>
      <View style={[styles.line, { backgroundColor: colors.unread }]} />
      <View style={[styles.pill, { backgroundColor: colors.accentBg, borderColor: colors.accentBorder }]}>
        <Txt variant="micro" weight="bold" mono uppercase color={colors.unread}>
          {label}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.screenX,
    paddingVertical: spacing.sm,
  },
  unreadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.screenX,
    paddingVertical: spacing.xs,
  },
  line: { flex: 1, height: 1 },
  pill: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
});
