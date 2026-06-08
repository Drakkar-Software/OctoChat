import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { useRoomsRegistry } from '@/lib/rooms-registry-context';
import { threadDraftKey } from '@/lib/use-draft';
import { useHardwareBack } from '@/lib/use-hardware-back';
import { useRoom } from '@/lib/use-room';
import { useRoomSend } from '@/lib/use-room-send';
import { useUnread } from '@/lib/unread-context';
import { spaceIdFromRoomId } from '@drakkar.software/octochat-sdk';
import type { RoomKind } from '@drakkar.software/octochat-sdk';
import { AppBar } from '@/components/ui/AppBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { StackScreen } from '@/components/ui/StackScreen';
import { Composer } from '@/components/chat/Composer';
import { ConversationSkeleton } from '@/components/chat/ConversationSkeleton';
import { OfflineBanner } from '@/components/chat/OfflineBanner';
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
  // Every room is an append-only log now — one hook for all kinds. Replies post the same
  // way for any kind: `send(text, parentId)`.
  const { store, opening, openError, offline, send, toggleReaction, editMessage, deleteMessage, pinMessage, unpinMessage, uploadAttachment, loadAttachment, canWrite } =
    useRoom(roomId);
  // Owner gates the per-message pin affordance and is the only author whose pin events
  // count at fold time (resolvePinned) — read from the shared registry like room/[id].
  const { owner } = useRoomsRegistry(spaceIdFromRoomId(roomId));
  const isOwner = !!owner && session?.userId === owner;
  const onPinMessage = (msgId: string, pin: boolean) => (pin ? pinMessage(msgId) : unpinMessage(msgId));
  // Offline outbox for this thread surface (keyed to roomId + parentId).
  const { online, pending, retry, sendText } = useRoomSend({ roomId, kind, parentId, send });

  // Mirror room/[id]: prefer the natural back action; fall through to `/rooms`
  // only if the thread is somehow the only screen in the stack (no thread deep
  // link today, but the guard costs one line and futureproofs). Same shape for
  // the Android hardware back via useFocusEffect + BackHandler.
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/rooms'));
  useHardwareBack(() => {
    if (router.canGoBack()) return false;
    router.replace('/(tabs)/rooms');
    return true;
  });

  return (
    <StackScreen
      contentStyle={styles.content}
      header={<AppBar title="Thread" subtitle={`#${roomName}`} onBack={goBack} right={<IconButton name="dots" accessibilityLabel="Thread options" />} />}
      footer={
        canWrite ? (
          <Composer
            placeholder="Reply in thread…"
            draftKey={session ? threadDraftKey(session.userId, roomId, parentId) : undefined}
            offline={!online}
            onSend={async (t, file) => {
              // Attachments need a live upload — the Composer blocks this path offline.
              if (file) {
                const ref = await uploadAttachment(file.bytes, file.name, file.mime);
                send(t, parentId, ref ?? undefined);
                return;
              }
              await sendText(t);
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
        <>
          {!online || offline ? <OfflineBanner subject="replies" /> : null}
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
          onPinMessage={onPinMessage}
          ownerId={owner ?? undefined}
          isOwner={isOwner}
          onOpenProfile={(userId) => router.push({ pathname: '/profile/[id]', params: { id: userId } })}
          onLoadAttachment={loadAttachment}
          pending={pending}
          onRetry={retry}
          />
        </>
      ) : (
        <EmptyState iconName="globe" title="Connecting…" />
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.sm, paddingBottom: spacing.md },
});
