import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { getProvider, type Room } from '@drakkar.software/octochat-sdk';
import { automationStatusColor, automationStatusLabel } from '@/lib/automation-status';
import { useTheme } from '@/lib/use-theme';
import { Txt } from '@/components/ui/Txt';
import type { IconName } from '@/components/ui/Icon';

import { ListRow } from './ListRow';

interface AgentRowProps {
  room: Room;
  /** Highlight as the open room (desktop). */
  active?: boolean;
  onPress: () => void;
}

/** One automated-room row: the provider-iconed {@link ListRow} plus a status line
 *  whose colour-coded dot + label make a disabled/failed agent scannable. Shared by
 *  the Automations surface and the Agents sidebar panel. */
export function AgentRow({ room, active, onPress }: AgentRowProps) {
  const { colors } = useTheme();
  const provider = room.automation ? getProvider(room.automation.providerId) : null;
  const statusColor = automationStatusColor(room.automation, colors);
  return (
    <View style={styles.item}>
      <ListRow
        iconName={(provider?.iconName ?? 'zap') as IconName}
        label={room.name}
        unread={room.unread}
        active={active}
        onPress={onPress}
      />
      <View style={styles.statusRow}>
        <View style={[styles.dot, { backgroundColor: statusColor }]} />
        <Txt variant="caption" tone="inkMuted" numberOfLines={1} style={styles.statusText}>
          {provider ? `${provider.name} · ` : ''}
          <Txt variant="caption" color={statusColor}>
            {automationStatusLabel(room.automation)}
          </Txt>
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  item: { gap: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  dot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { flex: 1 },
});
