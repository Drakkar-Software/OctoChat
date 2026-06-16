import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Txt } from '@/components/ui/Txt';
import { useTickets } from '@/lib/use-tickets';
import { TicketRow } from './TicketRow';
import type { TicketEntry } from '@/lib/use-tickets';

interface TicketListProps {
  spaceId: string;
}

/** Sidebar section listing all ticket rooms in the active space. */
export function TicketList({ spaceId }: TicketListProps) {
  const { colors } = useTheme();
  const { tickets } = useTickets(spaceId);

  if (tickets.length === 0) return null;

  const openTicket = (entry: TicketEntry) => {
    router.push({
      pathname: '/room/[id]',
      params: { id: entry.node.id, name: entry.node.title, kind: 'channel' },
    });
  };

  return (
    <View style={styles.section}>
      <Txt
        variant="caption"
        weight="semibold"
        mono
        uppercase
        color={colors.inkMuted}
        style={styles.header}
      >
        Tickets
      </Txt>
      {tickets.map((entry) => (
        <TicketRow key={entry.node.id} entry={entry} onPress={openTicket} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.sm },
  header: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
});
