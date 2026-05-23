import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { useRoom } from '@/lib/use-room';
import { useUnread } from '@/lib/unread-context';
import { spaceIdFromRoomId } from '@/lib/starfish/paths';
import { AppBar } from '@/components/ui/AppBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { StackScreen } from '@/components/ui/StackScreen';
import { Composer } from '@/components/chat/Composer';
import { ThreadConversation } from '@/components/chat/ThreadConversation';

export default function ThreadScreen() {
  const params = useLocalSearchParams<{ id: string; roomId: string; roomName?: string }>();
  const parentId = params.id;
  const roomId = params.roomId;
  const roomName = params.roomName ?? roomId;
  const { session } = useSession();
  const { lastReadAt } = useUnread();
  const { store, opening, openError, send, toggleReaction, editMessage, deleteMessage, uploadAttachment, loadAttachment } = useRoom(roomId);

  return (
    <StackScreen
      scroll
      contentStyle={styles.content}
      header={<AppBar title="Thread" subtitle={`#${roomName}`} onBack={() => router.back()} right={<IconButton name="dots" accessibilityLabel="Thread options" />} />}
      footer={
        <Composer
          placeholder="Reply in thread…"
          onSend={async (t, file) => {
            const ref = file ? await uploadAttachment(file.bytes, file.name, file.mime) : null;
            send(t, parentId, ref ?? undefined);
          }}
        />
      }
    >
      {!session ? (
        <EmptyState iconName="lock" title="Sign in first" />
      ) : opening ? (
        <EmptyState iconName="globe" title="Opening thread…" />
      ) : openError ? (
        <EmptyState iconName="alert" title="Couldn't open thread" subtitle={openError} />
      ) : store ? (
        <ThreadConversation
          store={store}
          spaceId={spaceIdFromRoomId(roomId)}
          parentId={parentId}
          currentUserId={session.userId}
          currentUserName={session.name}
          lastReadAt={lastReadAt(roomId)}
          onToggleReaction={toggleReaction}
          onEditMessage={editMessage}
          onDeleteMessage={deleteMessage}
          onOpenProfile={(userId) => router.push({ pathname: '/profile/[id]', params: { id: userId } })}
          onLoadAttachment={loadAttachment}
        />
      ) : (
        <EmptyState iconName="globe" title="Connecting…" />
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.sm, paddingBottom: spacing.md },
});
