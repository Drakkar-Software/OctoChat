import { router } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { isDmHomeId } from '@/lib/dm-home';
import { useSession } from '@/lib/session-context';
import { useRooms } from '@/lib/use-rooms';
import { useSpaces } from '@/lib/use-spaces';
import type { Room } from '@drakkar.software/octochat-sdk';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { AgentsPanel } from '@/components/chat/AgentsPanel';
import { SpaceTabHeader } from '@/components/chat/SpaceTabHeader';

/**
 * Agents bottom tab — the active space's automations. Mirrors the Agents mode
 * of the desktop sidebar: lists every `kind: 'automated'` room and links to the
 * full automations surface. Space context comes from {@link useSpaces}; the
 * space is switched from the Chat tab, and this tab follows it.
 */
export default function AgentsScreen() {
  const { session } = useSession();
  const { activeId } = useSpaces();
  const isDmHome = isDmHomeId(activeId);
  const { categories, isOwner } = useRooms(isDmHome ? null : activeId);

  // Owner manages automations; any member can browse a space that already has them.
  const hasAutomations = categories.some((c) => c.rooms.some((r) => r.kind === 'automated'));
  const showAutomations = !!session && !!activeId && !isDmHome && (isOwner || hasAutomations);

  const openRoom = (room: Room) =>
    router.push({ pathname: '/room/[id]', params: { id: room.id, name: room.name, kind: room.kind } });

  // Native gets the shared nav-stack header (see SpaceStackLayout) which owns the
  // top inset; web keeps the in-screen custom header with hide-on-scroll.
  const nativeHeader = Platform.OS !== 'web';

  return (
    <StackScreen
      inTabs
      scroll
      collapsibleHeader={!nativeHeader}
      header={nativeHeader ? undefined : <SpaceTabHeader />}
      headerProvidedNatively={nativeHeader}
      contentStyle={styles.content}
    >
      {!session ? (
        <SignInPrompt subtitle="Create an identity to manage agents." />
      ) : (
        <AgentsPanel
          categories={categories}
          available={!isDmHome}
          onOpenRoom={openRoom}
          onOpenAutomations={
            showAutomations && activeId
              ? () => router.push({ pathname: '/automations/[spaceId]', params: { spaceId: activeId } })
              : undefined
          }
        />
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: 96 },
});
