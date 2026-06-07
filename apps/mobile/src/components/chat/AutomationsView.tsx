import type { ReactNode } from 'react';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { getProvider } from '@drakkar.software/octochat-sdk';
import { useRoomsRegistryActions } from '@/lib/rooms-registry-context';
import { useRooms } from '@/lib/use-rooms';
import { useSession } from '@/lib/session-context';
import { useTheme } from '@/lib/use-theme';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { EmptyState } from '@/components/ui/EmptyState';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';
import { AutomatedRoomCreator } from '@/components/chat/AutomatedRoomCreator';
import { ListRow } from '@/components/chat/ListRow';
import type { IconName } from '@/components/ui/Icon';

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
  const { categories, isPublic, isOwner, loading } = useRooms(spaceId ?? null);
  const { refresh: refreshRegistry } = useRoomsRegistryActions();
  const [creatorOpen, setCreatorOpen] = useState(false);

  const automatedRooms = useMemo(
    () => categories.flatMap((c) => c.rooms).filter((r) => r.kind === 'automated'),
    [categories],
  );

  const canCreate = !!session && !!spaceId && isPublic && isOwner;

  return (
    <StackScreen header={header} contentStyle={styles.content} inTabs={inTabs} scroll>
      {!session ? (
        <SignInPrompt subtitle="Sign in to manage automations." />
      ) : !isPublic ? (
        <Callout tone="info" iconName="info">
          Automations are only available in public spaces in this version.
        </Callout>
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
          {automatedRooms.map((r) => {
            const provider = r.automation ? getProvider(r.automation.providerId) : null;
            // Single-line summary derived from the synced AutomationMeta — kept
            // terse so it fits in the row's existing single-label slot. Order:
            // disabled > error > commands-only > scheduled cadence.
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
  cta: { alignSelf: 'center' },
  createBar: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1 },
});
