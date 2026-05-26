import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

/**
 * Footer shown in place of the {@link Composer} when the viewer can't post —
 * e.g. a read-only public-stream invitation link, in a room or a thread.
 */
export function ReadOnlyFooter({
  message = 'Read-only — this invitation link can’t post here.',
}: {
  message?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { borderTopColor: colors.lineSoft }]}>
      <Icon name="eye" size={14} color={colors.inkMuted} />
      <Txt variant="footnote" tone="inkMuted">
        {message}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.screenX,
    borderTopWidth: 1,
  },
});
