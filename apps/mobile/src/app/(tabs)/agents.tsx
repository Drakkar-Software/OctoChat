import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { isDmHomeId } from '@/lib/dm-home';
import { useSession } from '@/lib/session-context';
import { useRooms } from '@/lib/use-rooms';
import { useSpaces } from '@/lib/use-spaces';
import type { Room } from '@/lib/types';
import { AppBar } from '@/components/ui/AppBar';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { AgentsPanel } from '@/components/chat/AgentsPanel';

/**
 * Agents bottom tab — the active space's automations. Mirrors the Agents mode
 * of the desktop sidebar: lists every `kind: 'automated'` room and links to the
 * full automations surface. Space context comes from {@link useSpaces}; the
 * space is switched from the Chat tab, and this tab follows it.
 */
export default function AgentsScreen() {
  const { session } = useSession();
  const { spaces, activeId } = useSpaces();
  const isDmHome = isDmHomeId(activeId);
  const { categories, isPublic, isOwner } = useRooms(isDmHome ? null : activeId);
  const space = isDmHome ? undefined : spaces.find((s) => s.id === activeId);

  const hasAutomations = categories.some((c) => c.rooms.some((r) => r.kind === 'automated'));
  const showAutomations = !!session && !!activeId && !isDmHome && isPublic && (isOwner || hasAutomations);

  const openRoom = (room: Room) =>
    router.push({ pathname: '/room/[id]', params: { id: room.id, name: room.name, kind: room.kind } });

  return (
    <StackScreen inTabs scroll header={<AppBar title="Agents" subtitle={space?.name} />} contentStyle={styles.content}>
      {!session ? (
        <SignInPrompt subtitle="Create an identity to manage agents." />
      ) : (
        <AgentsPanel
          categories={categories}
          isPublic={isDmHome ? false : isPublic}
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
