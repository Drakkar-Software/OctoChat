import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Txt } from '@/components/ui/Txt';

/** Centered date marker between message groups. */
export function DateDivider({ date }: { date: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.dateRow}>
      <View style={[styles.line, { backgroundColor: colors.lineFaint }]} />
      <Txt variant="micro" weight="semibold" mono uppercase tone="inkMuted">
        {date}
      </Txt>
      <View style={[styles.line, { backgroundColor: colors.lineFaint }]} />
    </View>
  );
}

/** "New messages" marker — accent rule with a trailing label. */
export function UnreadDivider({ label = 'New' }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.unreadRow}>
      <View style={[styles.line, { backgroundColor: colors.unread }]} />
      <Txt variant="micro" weight="bold" mono uppercase color={colors.unread}>
        {label}
      </Txt>
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
});
