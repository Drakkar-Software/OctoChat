import { useMemo } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { useTheme } from '@/lib/use-theme';
import { useRoomsRegistry } from '@/lib/rooms-registry-context';
import { threadDraftKey } from '@/lib/use-draft';
import { useHardwareBack } from '@/lib/use-hardware-back';
import { composeSend } from '@/lib/compose-send';
import { useRoom } from '@/lib/use-room';
import { useRoomSend } from '@/lib/use-room-send';
import { useUnreadActions } from '@/lib/unread-context';
import { spaceIdFromRoomId } from '@drakkar.software/octochat-sdk';
import type { RoomKind, StoredMsg } from '@drakkar.software/octochat-sdk';
import { useStarfishData } from '@drakkar.software/starfish-client/zustand';
import { buildSuggestionMessages } from '@drakkar.software/octochat-sdk';
import { makeEmptyConversationStore } from '@/lib/use-conversation-data';

// Stable empty store so useStarfishData can be called unconditionally while the
// real store is still null (thread opening). Created once at module scope — same
// pattern as room/[id].
const EMPTY_STORE = makeEmptyConversationStore();
import { AppBar } from '@/components/ui/AppBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { SignInPrompt } from '@/components/ui/SignInPrompt';
import { Txt } from '@/components/ui/Txt';
import { StackScreen } from '@/components/ui/StackScreen';
import { Composer } from '@/components/chat/Composer';
import { ConversationSkeleton } from '@/components/chat/ConversationSkeleton';
import { OfflineBanner } from '@/components/chat/OfflineBanner';
import { ReadOnlyFooter } from '@/components/chat/ReadOnlyFooter';
import { ThreadConversation } from '@/components/chat/ThreadConversation';

export default function ThreadScreen() {
  const params = useLocalSearchParams<{ id: string; roomId: string; spaceId?: string; roomName?: string; kind?: string }>();
  const parentId = params.id;
  const roomId = params.roomId;
  // Ticket ids embed no space segment; the room screen passes spaceId explicitly for them.
  const threadSpaceId = params.spaceId ?? spaceIdFromRoomId(roomId);
  const roomName = params.roomName ?? roomId;
  const kind = (params.kind ?? 'channel') as RoomKind;
  const { colors } = useTheme();
  const { session } = useSession();
  const { lastReadAt } = useUnreadActions();
  // Owner gates the per-message pin affordance and is the only author whose pin events
  // count at fold time (resolvePinned) — read from the shared registry like room/[id].
  // Also provides the room's access/enc tier so useRoom picks the right stream collection.
  const { owner, rooms } = useRoomsRegistry(threadSpaceId);
  const registryRoom = rooms.find((r) => r.id === roomId) ?? null;
  // Every room is an append-only log now — one hook for all kinds. Replies post the same
  // way for any kind: `send(text, parentId)`.
  const { store, opening, openError, offline, send, toggleReaction, editMessage, deleteMessage, pinMessage, unpinMessage, uploadAttachment, loadAttachment, canWrite } =
    useRoom(roomId, { access: registryRoom?.access, enc: registryRoom?.enc });
  const isOwner = !!owner && session?.userId === owner;
  const onPinMessage = (msgId: string, pin: boolean) => (pin ? pinMessage(msgId) : unpinMessage(msgId));
  // Offline outbox for this thread surface (keyed to roomId + parentId).
  const { online, pending, retry, sendText } = useRoomSend({ roomId, spaceId: threadSpaceId, access: registryRoom?.access, kind, parentId, send });

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

  // Reply-suggestion context — scoped to THIS thread (parent + its replies), not
  // the room's full log, so the on-device model suggests a reply that fits the
  // thread. Mirrors room/[id]; the same Composer/chip render it. Last message =
  // the last reply (or the parent when there are none yet).
  const allMessages = (useStarfishData(store ?? EMPTY_STORE, (d) => d.messages as StoredMsg[] | undefined) ?? []) as StoredMsg[];
  const threadMessages = useMemo(() => {
    const parent = allMessages.find((m) => m.id === parentId);
    const replies = allMessages.filter((m) => m.parentId === parentId);
    return parent ? [parent, ...replies] : replies;
  }, [allMessages, parentId]);
  const lastThreadMsg = threadMessages.at(-1) ?? null;
  const suggestionContext = useMemo(() => {
    if (!session || !canWrite) return undefined;
    // No `onOpenThread` here — threads don't nest, so the model won't suggest one.
    return {
      lastMsgId: lastThreadMsg && lastThreadMsg.authorId !== session.userId ? lastThreadMsg.id : null,
      buildMessages: () => buildSuggestionMessages(threadMessages, session.userId),
      onReact: (msgId: string, emoji: string) => toggleReaction(msgId, emoji),
      onPin: isOwner ? (msgId: string) => pinMessage(msgId) : undefined,
    };
  }, [session, canWrite, lastThreadMsg, threadMessages, isOwner, toggleReaction, pinMessage]);

  return (
    <StackScreen
      contentStyle={styles.content}
      header={
        <AppBar
          title="Thread"
          // A thread glyph + the source channel signals "side conversation off
          // #room" — the navigation cue the bare "#room" string lacked. The old
          // dots button was inert (no handler), so it's dropped rather than faked.
          subtitle={
            <>
              <Icon name="thread" size={12} color={colors.accent} />
              <Txt variant="caption" tone="inkMuted" numberOfLines={1}>
                {kind === 'dm' ? roomName : `#${roomName}`}
              </Txt>
            </>
          }
          onBack={goBack}
        />
      }
      footer={
        canWrite ? (
          <Composer
            placeholder="Reply in thread…"
            draftKey={session ? threadDraftKey(session.userId, roomId, parentId) : undefined}
            offline={!online}
            suggestionContext={suggestionContext}
            onSend={(t, file) =>
              void composeSend({
                text: t,
                file,
                parentId,
                uploadAttachment,
                send,
                sendText,
              })
            }
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
