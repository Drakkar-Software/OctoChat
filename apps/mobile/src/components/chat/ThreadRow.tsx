import { Pressable, StyleSheet } from 'react-native';

import { radii, spacing } from '@/theme';
import type { ThreadSummary } from '@/lib/threads';
import { useHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

/** A recent thread shown indented beneath its channel in the desktop sidebar —
 *  a reply glyph, the thread's label, and an unread badge. Threads with unread
 *  replies emphasise (darker, semibold) like {@link ChannelRow}. */
export function ThreadRow({ thread, onPress }: { thread: ThreadSummary; onPress?: () => void }) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  const unread = thread.unread > 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Thread: ${thread.label}`}
      onPress={onPress}
      {...hoverProps}
      style={[styles.row, { backgroundColor: hovered ? colors.hover : 'transparent' }]}
    >
      <Icon name="reply" size={12} color={unread ? colors.ink : colors.inkMuted} />
      <Txt
        variant="footnote"
        weight={unread ? 'semibold' : 'regular'}
        color={unread ? colors.ink : colors.inkSoft}
        numberOfLines={1}
        style={styles.label}
      >
        {thread.label}
      </Txt>
      <Badge count={thread.unread} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    // Indent past the channel row's glyph + gap so threads nest under the name.
    marginLeft: spacing.xl,
    paddingVertical: 5,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  label: { flex: 1 },
});
