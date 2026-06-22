import type { ReactNode } from 'react';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Room } from '@drakkar.software/octochat-sdk';
import { spacing } from '@/theme';
import { useRoomsRegistryActions } from '@/lib/rooms-registry-context';
import { useRooms } from '@/lib/use-rooms';
import { useSession } from '@/lib/session-context';
import { useTheme } from '@/lib/use-theme';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { AgentRow } from '@/components/chat/AgentRow';
import { AgentDetailSheet } from '@/components/chat/AgentsPanel';
import { AutomatedRoomCreator } from '@/components/chat/AutomatedRoomCreator';

interface AutomationsViewProps {
  /** Space whose automations are listed; `null` while none is active. */
  spaceId: string | null;
  /** Header node (usually an <AppBar/>) — back button vs. tab title differ. */
  header: ReactNode;
  /** Set when rendered inside the tab navigator so the bottom inset is left to the tab bar. */
  inTabs?: boolean;
}

/**
 * Automations list for a space — every `kind: 'automated'` room plus the
 * owner-only {@link AutomatedRoomCreator}. Shared by the per-space
 * `/automations/[spaceId]` destination (reached from the room sidebar) and the
 * `automations` bottom tab, which both wrap it with their own header.
 */
export function AutomationsView({ spaceId, header, inTabs = false }: AutomationsViewProps) {
  const { colors } = useTheme();
  const { session } = useSession();
  const { categories, isOwner, loading, reload } = useRooms(spaceId ?? null);
  const { refresh: refreshRegistry } = useRoomsRegistryActions();
  const [creatorOpen, setCreatorOpen] = useState(false);
  // Members inspect an agent in a read-only sheet; owners jump straight into the room
  // (where they reach the settings sheet). Branch the row tap on ownership.
  const [detail, setDetail] = useState<Room | null>(null);

  const automatedRooms = useMemo(
    () => categories.flatMap((c) => c.rooms.filter((r) => r.kind === 'automated')),
    [categories],
  );

  // Owners create automations in a PUBLIC space or an OWNED PRIVATE one (the SDK branches the
  // bot credential on space type). Non-owners only browse existing ones.
  const canCreate = !!session && !!spaceId && isOwner;

  const openRoom = (r: Room) =>
    router.push({ pathname: '/room/[id]', params: { id: r.id, name: r.name, kind: 'automated' } });

  return (
    <StackScreen header={header} contentStyle={styles.content} inTabs={inTabs} scroll>
      {!session ? (
        <SignInPrompt subtitle="Sign in to manage automations." />
      ) : loading ? null : automatedRooms.length === 0 ? (
        <EmptyState
          iconName="zap"
          title="No automations yet"
          subtitle={
            canCreate
              ? 'Wire an integration into a room — it posts as a bot and answers /commands.'
              : 'The space owner can add automations.'
          }
        >
          {canCreate ? (
            <Button label="New automation" iconName="plus" variant="primary" style={styles.cta} onPress={() => setCreatorOpen(true)} />
          ) : null}
        </EmptyState>
      ) : (
        <View style={styles.list}>
          {automatedRooms.map((r) => (
            <AgentRow key={r.id} room={r} onPress={() => (isOwner ? openRoom(r) : setDetail(r))} />
          ))}
          {canCreate ? (
            <View style={[styles.createBar, { borderTopColor: colors.lineFaint }]}>
              <Button label="New automation" iconName="plus" variant="primary" full onPress={() => setCreatorOpen(true)} />
            </View>
          ) : null}
        </View>
      )}
      {creatorOpen && session && spaceId ? (
        <AutomatedRoomCreator
          session={session}
          spaceId={spaceId}
          onClose={() => setCreatorOpen(false)}
          onCreated={async (roomId) => {
            setCreatorOpen(false);
            // The automation room was created through the headless SDK path, which bypasses
            // the live object-index store — re-pull it so this list repaints in-session.
            reload();
            await refreshRegistry(spaceId);
            router.push({ pathname: '/room/[id]', params: { id: roomId, kind: 'automated' } });
          }}
        />
      ) : null}
      {detail ? (
        <AgentDetailSheet
          room={detail}
          onOpenRoom={() => {
            const r = detail;
            setDetail(null);
            openRoom(r);
          }}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: 96 },
  list: { gap: spacing.xs },
  cta: { alignSelf: 'center' },
  createBar: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1 },
});
