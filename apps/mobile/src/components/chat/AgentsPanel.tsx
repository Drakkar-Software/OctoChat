import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { getProvider } from '@drakkar.software/octochat-sdk';
import { useTheme } from '@/lib/use-theme';
import type { Room } from '@drakkar.software/octochat-sdk';
import type { RoomCategory } from '@/lib/use-rooms';
import { Callout } from '@/components/ui/Callout';
import { Txt } from '@/components/ui/Txt';

import { ListRow } from './ListRow';
import type { IconName } from '@/components/ui/Icon';
import { SidebarLinkRow } from './SidebarLinkRow';

interface AgentsPanelProps {
  categories: RoomCategory[];
  /** Automations require a public space; gates the help copy. */
  isPublic?: boolean;
  /** Open one of the automated rooms (the bot conversation). */
  onOpenRoom: (room: Room) => void;
  /** Open the full automations surface (creator + per-agent settings). */
  onOpenAutomations?: () => void;
  automationsActive?: boolean;
  /** Highlight the active automated room (desktop). */
  activeRoomId?: string;
}

/**
 * Body of the **Agents** view mode — the active space's automations. Lists every
 * `kind: 'automated'` room (each row carries its provider + cadence) and a
 * "Manage automations" link to the existing {@link AutomationsView} for creating
 * and configuring them. A plain `<View>` so it nests inside the sidebar's
 * scroll on desktop and the rooms screen's scroll on mobile without conflict.
 */
export function AgentsPanel({
  categories,
  isPublic,
  onOpenRoom,
  onOpenAutomations,
  automationsActive,
  activeRoomId,
}: AgentsPanelProps) {
  const { colors } = useTheme();
  const agents = useMemo(
    () => categories.flatMap((c) => c.rooms).filter((r) => r.kind === 'automated'),
    [categories],
  );

  if (isPublic === false) {
    return (
      <View style={styles.note}>
        <Callout tone="info" iconName="info">
          Automations are only available in public spaces in this version.
        </Callout>
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      {onOpenAutomations ? (
        <SidebarLinkRow iconName="zap" label="Manage automations" active={automationsActive} onPress={onOpenAutomations} />
      ) : null}
      {agents.length === 0 ? (
        <Txt variant="footnote" tone="inkMuted" style={styles.empty}>
          No agents yet.
        </Txt>
      ) : (
        agents.map((r) => {
          const provider = r.automation ? getProvider(r.automation.providerId) : null;
          const status = !r.automation?.enabled
            ? 'Disabled'
            : r.automation.lastError
              ? 'Failed'
              : r.automation.onOpen
                ? 'On open'
                : r.automation.intervalMin === 0
                  ? 'Commands-only'
                  : `Every ${r.automation.intervalMin} min`;
          return (
            <View key={r.id} style={styles.item}>
              <ListRow
                iconName={(provider?.iconName ?? 'zap') as IconName}
                label={r.name}
                active={r.id === activeRoomId}
                onPress={() => onOpenRoom(r)}
              />
              <Txt variant="caption" tone="inkMuted" style={styles.status} numberOfLines={1}>
                {provider ? `${provider.name} · ` : ''}
                {status}
              </Txt>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.xs },
  note: { padding: spacing.sm },
  item: { gap: 2 },
  status: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  empty: { padding: spacing.md },
});
