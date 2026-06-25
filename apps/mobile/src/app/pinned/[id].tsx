import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';

import { layout, spacing } from '@/theme';
import type { CrossRoomMessage } from '@drakkar.software/octochat-sdk';
import { useSession } from '@/lib/session-context';
import { useSpaces } from '@/lib/use-spaces';
import { usePins } from '@/lib/use-pins';
import { AppBar } from '@/components/ui/AppBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { MessageListSkeleton } from '@/components/chat/MessageListSkeleton';
import { MessageResult } from '@/components/chat/MessageResult';

/** Space-wide list of every message the owner has pinned, aggregated across the
 *  space's rooms like the Threads tab. Reached from a room's header pin button. */
export default function PinnedScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const spaceId = params.id;
  const { session } = useSession();
  const { spaces } = useSpaces();
  const { pins, loading } = usePins(spaceId);
  const space = spaces.find((s) => s.id === spaceId);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/rooms'));

  // A pinned reply opens its thread; a top-level pin opens the room (mirrors Search).
  const open = (r: CrossRoomMessage) =>
    r.msg.parentId
      ? router.push({
          pathname: '/thread/[id]',
          params: { id: r.msg.parentId, roomId: r.room.id, roomName: r.room.name, kind: r.room.kind },
        })
      : router.push({ pathname: '/room/[id]', params: { id: r.room.id, name: r.room.name, kind: r.room.kind } });

  return (
    <StackScreen header={<AppBar title="Pinned" subtitle={space?.name} onBack={goBack} />} contentStyle={styles.content}>
      {!session ? (
        <SignInPrompt />
      ) : loading && pins.length === 0 ? (
        <MessageListSkeleton count={4} />
      ) : pins.length === 0 ? (
        <EmptyState
          iconName="pin"
          title="No pinned messages"
          subtitle="Messages the space owner pins gather here for everyone."
        />
      ) : (
        // Virtualized like Search/Threads: recycleItems off (rows hold hover state),
        // a separator stands in for the container `gap`.
        <LegendList
          style={styles.flex}
          contentContainerStyle={styles.list}
          data={pins}
          keyExtractor={(r) => r.room.id + r.msg.id}
          estimatedItemSize={88}
          ItemSeparatorComponent={Separator}
          renderItem={({ item: r }) => (
            <MessageResult room={r.room} msg={r.msg} currentUserId={session.userId} onPress={() => open(r)} />
          )}
        />
      )}
    </StackScreen>
  );
}

/** Spacer between rows — the virtualized list can't honor the container `gap`. */
const Separator = () => <View style={styles.gap} />;

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screenX, paddingTop: spacing.md, gap: spacing.md },
  flex: { flex: 1 },
  list: { paddingBottom: layout.tabBarSafeBottom },
  gap: { height: spacing.sm },
});
