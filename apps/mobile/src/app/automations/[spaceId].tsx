import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { getProvider } from '@/lib/automations/providers';
import { useRoomsRegistryActions } from '@/lib/rooms-registry-context';
import { useRooms } from '@/lib/use-rooms';
import { useSession } from '@/lib/session-context';
import { useTheme } from '@/lib/use-theme';
import { AppBar } from '@/components/ui/AppBar';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { EmptyState } from '@/components/ui/EmptyState';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';
import { AutomatedRoomCreator } from '@/components/chat/AutomatedRoomCreator';
import { ListRow } from '@/components/chat/ListRow';

/**
 * Per-space Automations destination — reached from the room sidebar's
 * "Automations" link. Lists every `kind: 'automated'` room in the active space
 * and hosts the {@link AutomatedRoomCreator} via a "New automation" button
 * shown both in the empty state and below the populated list (owner-only).
 */
export default function AutomationsScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { colors } = useTheme();
  const { session } = useSession();
  const { categories, isPublic, isOwner, loading } = useRooms(spaceId ?? null);
  const { refresh: refreshRegistry } = useRoomsRegistryActions();
  const [creatorOpen, setCreatorOpen] = useState(false);

  const automatedRooms = useMemo(
    () => categories.flatMap((c) => c.rooms).filter((r) => r.kind === 'automated'),
    [categories],
  );

  const canCreate = !!session && !!spaceId && isPublic && isOwner;

  return (
    <StackScreen
      header={<AppBar title="Automations" onBack={() => router.back()} />}
      contentStyle={styles.content}
      scroll
    >
      {!session ? (
        <SignInPrompt subtitle="Sign in to manage automations." />
      ) : !isPublic ? (
        <Callout tone="info" iconName="info">
          Automations are only available in public spaces in this version.
        </Callout>
      ) : loading ? null : automatedRooms.length === 0 ? (
        <EmptyState
          iconName="refresh"
          title="No automations yet"
          subtitle={
            canCreate
              ? 'Wire an integration into a room — it posts as a bot and answers /commands.'
              : 'The space owner can add automations.'
          }
        >
          {canCreate ? (
            <Button label="New automation" iconName="plus" variant="primary" onPress={() => setCreatorOpen(true)} />
          ) : null}
        </EmptyState>
      ) : (
        <View style={styles.list}>
          {automatedRooms.map((r) => {
            const provider = r.automation ? getProvider(r.automation.providerId) : null;
            // Single-line summary derived from the synced AutomationMeta — kept
            // terse so it fits in the row's existing single-label slot. Order:
            // disabled > error > commands-only > scheduled cadence.
            const status = !r.automation?.enabled
              ? 'Disabled'
              : r.automation.lastError
                ? 'Failed'
                : r.automation.intervalMin === 0
                  ? 'Commands-only'
                  : `Every ${r.automation.intervalMin} min`;
            return (
              <View key={r.id} style={styles.item}>
                <ListRow
                  iconName={provider?.iconName ?? 'refresh'}
                  label={r.name}
                  onPress={() =>
                    router.push({ pathname: '/room/[id]', params: { id: r.id, name: r.name, kind: 'automated' } })
                  }
                />
                <View style={styles.statusLine}>
                  <Txt variant="caption" tone="inkMuted" style={styles.statusText}>
                    {provider ? `${provider.name} · ` : ''}
                    {status}
                  </Txt>
                </View>
              </View>
            );
          })}
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
            await refreshRegistry(spaceId);
            router.push({ pathname: '/room/[id]', params: { id: roomId, kind: 'automated' } });
          }}
        />
      ) : null}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: 96 },
  list: { gap: spacing.xs },
  item: { gap: 2 },
  statusLine: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  statusText: {},
  createBar: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1 },
});
