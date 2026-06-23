import { View, StyleSheet, Pressable } from 'react-native';
import { useTheme } from '@/lib/use-theme';
import { useHover } from '@/lib/use-hover';
import { radii, spacing } from '@/theme';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { StatusPill } from './StatusPill';
import type { TicketEntry } from '@/lib/use-tickets';

interface TicketRowProps {
  entry: TicketEntry;
  onPress: (entry: TicketEntry) => void;
  onLongPress?: (entry: TicketEntry) => void;
}

/** A single row in the ticket list sidebar section. */
export function TicketRow({ entry, onPress, onLongPress }: TicketRowProps) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  const { ticket, title, requester, unread } = entry;

  return (
    <Pressable
      onPress={() => onPress(entry)}
      onLongPress={onLongPress ? () => onLongPress(entry) : undefined}
      style={({ pressed }) => [styles.row, (pressed || hovered) && { backgroundColor: colors.hover }]}
      {...hoverProps}
    >
      {entry.node.enc ? <Icon name="lock" size={15} color={colors.inkMuted} /> : null}
      <View style={styles.content}>
        <Txt variant="body" weight="medium" numberOfLines={1} style={styles.title}>
          {title}
        </Txt>
        {requester ? (
          <Txt variant="caption" color={colors.inkMuted} numberOfLines={1}>
            {requester}
          </Txt>
        ) : null}
      </View>
      {/* Unread badge self-hides when count is 0. */}
      <Badge count={unread} />
      {/* alignSelf:'center' overrides Pill's own flex-start so the pill stays
          vertically centered even when the content column is two lines tall. */}
      <StatusPill status={ticket.status} style={styles.pillCenter} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
    borderRadius: radii.md,
  },
  content: { flex: 1 },
  title: { flexShrink: 1 },
  pillCenter: { alignSelf: 'center' },
});
