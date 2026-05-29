import { useCallback } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { BackHandler, StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { threadDraftKey } from '@/lib/use-draft';
import { useRoom } from '@/lib/use-room';
import { useStreamRoom } from '@/lib/use-stream-room';
import { useUnread } from '@/lib/unread-context';
import { spaceIdFromRoomId } from '@/lib/starfish/paths';
import type { RoomKind } from '@/lib/types';
import { AppBar } from '@/components/ui/AppBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { Composer } from '@/components/chat/Composer';
import { ConversationSkeleton } from '@/components/chat/ConversationSkeleton';
import { ReadOnlyFooter } from '@/components/chat/ReadOnlyFooter';
import { ThreadConversation } from '@/components/chat/ThreadConversation';

export default function ThreadScreen() {
  const params = useLocalSearchParams<{ id: string; roomId: string; roomName?: string; kind?: string }>();
  const parentId = params.id;
  const roomId = params.roomId;
  const roomName = params.roomName ?? roomId;
  const kind = (params.kind ?? 'channel') as RoomKind;
  const { session } = useSession();
  const { lastReadAt } = useUnread();
  // Mirror room/[id]: a stream thread is append-only (useStreamRoom), a channel/dm
  // thread is a merge-doc room (useRoom). Both hooks run (React rules) but only the
  // one matching `kind` is enabled; we pick its result. Replies post the same way —
  // `send(text, parentId)` — for either kind.
  const isStream = kind === 'stream';
  const channel = useRoom(roomId, { enabled: !isStream });
  const stream = useStreamRoom(roomId, { enabled: isStream });
  const { store, opening, openError, send, toggleReaction, editMessage, deleteMessage, uploadAttachment, loadAttachment, canWrite } =
    isStream ? stream : channel;

  // Mirror room/[id]: prefer the natural back action; fall through to `/rooms`
  // only if the thread is somehow the only screen in the stack (no thread deep
  // link today, but the guard costs one line and futureproofs). Same shape for
  // the Android hardware back via useFocusEffect + BackHandler.
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/rooms'));
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (router.canGoBack()) return false;
        router.replace('/(tabs)/rooms');
        return true;
      });
      return () => sub.remove();
    }, []),
  );

  return (
    <StackScreen
      contentStyle={styles.content}
      header={<AppBar title="Thread" subtitle={`#${roomName}`} onBack={goBack} right={<IconButton name="dots" accessibilityLabel="Thread options" />} />}
      footer={
        canWrite ? (
          <Composer
            placeholder="Reply in thread…"
            draftKey={session ? threadDraftKey(session.userId, roomId, parentId) : undefined}
            onSend={async (t, file) => {
              const ref = file ? await uploadAttachment(file.bytes, file.name, file.mime) : null;
              send(t, parentId, ref ?? undefined);
            }}
          />
        ) : (
          <ReadOnlyFooter message="Read-only — this invitation link can’t reply here." />
        )
      }
    >
      {!session ? (
        <SignInPrompt />
      ) : opening ? (
        <ConversationSkeleton />
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
