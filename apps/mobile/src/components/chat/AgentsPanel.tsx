import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { motion, radii, spacing } from '@/theme';
import { getProvider, type Room } from '@drakkar.software/octochat-sdk';
import { cadenceNote } from '@/components/chat/IntervalPicker';
import { automationStatusColor, automationStatusLabel } from '@/lib/automation-status';
import { useTheme } from '@/lib/use-theme';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';
import type { RoomCategory } from '@/lib/use-rooms';

import { AgentRow } from './AgentRow';
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
  /** When explicitly `false`, a member tap opens a read-only {@link AgentDetailSheet}
   *  (what the agent does / its cadence / how to drive it) instead of dead-ending on the
   *  owner-only settings. Absent/`true` → unchanged: a tap opens the room. Optional so the
   *  existing callers (which don't pass it) keep their current behavior. */
  isOwner?: boolean;
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
  isOwner,
}: AgentsPanelProps) {
  const agents = useMemo(
    () => categories.flatMap((c) => c.rooms).filter((r) => r.kind === 'automated'),
    [categories],
  );
  // Members (isOwner explicitly false) tap a row to inspect the agent rather than open the
  // room; the sheet itself offers "Open conversation" so the room stays reachable.
  const memberView = isOwner === false;
  const [detail, setDetail] = useState<Room | null>(null);

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
        <View style={styles.empty}>
          <EmptyState iconName="zap" title="No agents yet" subtitle="Wire an integration to post as a bot and answer /commands." />
        </View>
      ) : (
        agents.map((r) => (
          <AgentRow
            key={r.id}
            room={r}
            active={r.id === activeRoomId}
            onPress={() => (memberView ? setDetail(r) : onOpenRoom(r))}
          />
        ))
      )}
      {detail ? (
        <AgentDetailSheet
          room={detail}
          onOpenRoom={() => {
            const r = detail;
            setDetail(null);
            onOpenRoom(r);
          }}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </View>
  );
}

/** Distance the sheet springs up from on mount — larger than the tallest sheet. */
const SHEET_RISE = 600;

/**
 * Read-only agent detail for a member (non-owner): what the agent is, how often it runs in
 * plain words (shared {@link cadenceNote}), and how to drive it via /commands — so the
 * agents surface is informative instead of dead-ending on the owner-only settings. An
 * "Open conversation" action keeps the room reachable. Exported so both the Agents panel
 * and {@link AutomationsView} open the same sheet.
 */
export function AgentDetailSheet({
  room,
  onOpenRoom,
  onClose,
}: {
  room: Room;
  onOpenRoom: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const auto = room.automation;
  const provider = auto ? getProvider(auto.providerId) : null;
  const statusColor = automationStatusColor(auto ?? undefined, colors);
  const note = auto ? cadenceNote({ intervalMin: auto.intervalMin, onOpen: auto.onOpen ?? false, schedule: auto.schedule }, true) : null;
  const commands = provider?.commands ?? [];

  const reduced = useReducedMotion();
  const rise = useSharedValue(reduced ? 0 : SHEET_RISE);
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: rise.value }] }));
  useEffect(() => {
    if (reduced) return;
    rise.value = withSpring(0, motion.spring);
  }, [reduced, rise]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.backdrop, { backgroundColor: colors.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss" />
        <Animated.View style={[styles.sheetWrap, sheetStyle]}>
          <View style={[styles.sheet, { backgroundColor: colors.paper }]}>
            <ScrollView contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
              <View style={styles.sheetHeader}>
                <View style={styles.sheetHeaderText}>
                  <Txt variant="micro" weight="bold" mono uppercase tone="inkMuted">
                    Automation
                  </Txt>
                  <Txt variant="title">{room.name}</Txt>
                </View>
                <IconButton name="x" onPress={onClose} accessibilityLabel="Close" color={colors.inkMuted} />
              </View>

              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <Txt variant="caption" tone="inkMuted">
                  {provider ? `${provider.name} · ` : ''}
                  <Txt variant="caption" color={statusColor}>
                    {automationStatusLabel(auto ?? undefined)}
                  </Txt>
                </Txt>
              </View>

              {provider ? (
                <Txt variant="callout" tone="inkSoft">
                  {provider.description}
                </Txt>
              ) : null}

              {note ? (
                <Card title="Schedule">
                  <Txt variant="footnote" tone="inkSoft">
                    {note}
                  </Txt>
                </Card>
              ) : null}

              {commands.length ? (
                <Card title="Commands">
                  {commands.map((c) => (
                    <View key={c.name} style={styles.command}>
                      <Txt variant="caption" mono color={colors.accentInk}>
                        {c.usage}
                      </Txt>
                      <Txt variant="caption" tone="inkMuted">
                        {c.description}
                      </Txt>
                    </View>
                  ))}
                </Card>
              ) : null}

              <View style={styles.sheetAction}>
                <Button label="Open conversation" iconName="arrow-r" variant="primary" full onPress={onOpenRoom} />
              </View>
            </ScrollView>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.xs },
  note: { padding: spacing.sm },
  // Give the (flex:1) EmptyState a defined height inside the compact panel.
  empty: { minHeight: 200 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheetWrap: { maxHeight: '90%' },
  sheet: { flexShrink: 1, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet },
  sheetBody: { gap: spacing.sm, padding: spacing.lg },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  sheetHeaderText: { flex: 1, gap: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  command: { gap: 2 },
  sheetAction: { paddingTop: spacing.sm },
});
