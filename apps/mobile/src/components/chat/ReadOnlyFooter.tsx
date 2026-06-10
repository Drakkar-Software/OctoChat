import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

/**
 * Footer shown in place of the {@link Composer} when the viewer can't post —
 * e.g. a read-only public-stream invitation link, in a room or a thread.
 *
 * It reads as a quiet but present dock (a `paperAlt` fill with the lit-from-above
 * top edge) rather than a whispered hairline, and can offer a path forward
 * (`actionLabel` + `onAction`, e.g. "Join this space to reply") so a link-join
 * that lands here isn't a dead end.
 */
export function ReadOnlyFooter({
  message = 'Read-only — this invitation link can’t post here.',
  actionLabel,
  onAction,
}: {
  message?: string;
  /** Optional inviting CTA (e.g. "Join to reply"); renders a ghost Button when wired. */
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { backgroundColor: colors.paperAlt, borderTopColor: colors.hairlineHi }]}>
      <View style={styles.note}>
        <Icon name="eye" size={14} color={colors.inkMuted} />
        <Txt variant="footnote" tone="inkMuted">
          {message}
        </Txt>
      </View>
      {actionLabel && onAction ? (
        <Button label={actionLabel} variant="ghost" size="sm" iconName="arrow-r" onPress={onAction} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.screenX,
    borderTopWidth: 1,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
});
