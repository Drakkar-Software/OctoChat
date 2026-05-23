import { useCallback, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { roomDraftKey } from '@/lib/use-draft';
import { useMessageEditing } from '@/lib/use-message-editing';
import { useRoom } from '@/lib/use-room';
import { useUnread } from '@/lib/unread-context';
import { spaceIdFromRoomId } from '@/lib/starfish/paths';
import type { RoomKind } from '@/lib/types';
import { useTheme } from '@/lib/use-theme';
import { AppBar } from '@/components/ui/AppBar';
import { Callout } from '@/components/ui/Callout';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';
import { Composer } from '@/components/chat/Composer';
import { DesktopChatTopbar } from '@/components/chat/DesktopChatTopbar';
import { RoomConversation } from '@/components/chat/RoomConversation';
import { ThreadDigestPublisher } from '@/components/chat/ThreadDigestPublisher';

export default function RoomScreen() {
  const params = useLocalSearchParams<{ id: string; name?: string; kind?: string }>();
  const id = params.id;
  const name = params.name ?? id;
  const kind = (params.kind ?? 'channel') as RoomKind;
  const { colors } = useTheme();
  const { session } = useSession();
  const { markRoomRead, lastReadAt } = useUnread();
  const { store, opening, openError, syncError, send, toggleReaction, editMessage, deleteMessage, uploadAttachment, loadAttachment, canWrite } =
    useRoom(id);
  const { editingId, setEditingId, editLast } = useMessageEditing(store, session?.userId ?? '');
  const title = kind === 'dm' ? name : `#${name}`;

  // The room's last-read mark as it stood at the START of this visit — re-captured
  // on EVERY focus (lazy-initialised to avoid a first-render "all unread" flash).
  // Messages and threads newer than it render as unread for the visit (escalating an
  // @mention's highlight) even after the room is marked read on open. Capturing per
  // focus — not once per mount — is what fixes thread badges sticking unread forever:
  // returning from a thread (this screen stays mounted underneath) or re-entering the
  // room re-reads the now-advanced mark, so threads caught up since stop reading unread.
  const [readBefore, setReadBefore] = useState(() => lastReadAt(id));

  // Mark this room read whenever it becomes the focused screen — on first open AND on
  // returning to it after it sat backgrounded (where it accrues unread, since useRoom
  // only suppresses change-events while focused). Snapshot readBefore FIRST: lastReadAt
  // reads the very mark markRoomRead is about to overwrite, so the order matters.
  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      setReadBefore(lastReadAt(id));
      markRoomRead(id);
    }, [session, id, lastReadAt, markRoomRead]),
  );

  const openThread = (msgId: string) =>
    router.push({ pathname: '/thread/[id]', params: { id: msgId, roomId: id, roomName: name } });
  const openMembers = () => router.push({ pathname: '/space/[id]', params: { id: spaceIdFromRoomId(id) } });
  const openSearch = () => router.push('/(tabs)/search');
  const openProfile = (userId: string) => router.push({ pathname: '/profile/[id]', params: { id: userId } });

  return (
    <StackScreen
      contentStyle={styles.content}
      header={
        <AppBar
          title={title}
          onBack={() => router.back()}
          right={
            <>
              <IconButton name="search" accessibilityLabel="Search in room" onPress={openSearch} />
              <IconButton name="people" accessibilityLabel="Members" onPress={openMembers} />
            </>
          }
        />
      }
      desktopHeader={<DesktopChatTopbar name={name} kind={kind} onSearch={openSearch} />}
      footer={
        canWrite ? (
          <Composer
            placeholder={`Message ${title}`}
            draftKey={session ? roomDraftKey(session.userId, id) : undefined}
            onSend={async (t, file) => {
              const ref = file ? await uploadAttachment(file.bytes, file.name, file.mime) : null;
              send(t, undefined, ref ?? undefined);
            }}
            onEditLast={editLast}
          />
        ) : (
          <View style={[styles.readonly, { borderTopColor: colors.lineSoft }]}>
            <Icon name="eye" size={14} color={colors.inkMuted} />
            <Txt variant="footnote" tone="inkMuted">
              Read-only — this invitation link can’t post here.
            </Txt>
          </View>
        )
      }
    >
      {!session ? (
        <EmptyState iconName="lock" title="Sign in first" subtitle="Create an identity to open encrypted rooms." />
      ) : opening ? (
        <EmptyState iconName="globe" title="Opening room…" subtitle="Fetching keys and decrypting messages." />
      ) : openError ? (
        <EmptyState iconName="alert" title="Couldn't open room" subtitle={openError} />
      ) : store ? (
        <>
          {syncError ? (
            <Callout tone="warning" iconName="alert">
              {syncError}
            </Callout>
          ) : null}
          <RoomConversation
            store={store}
            spaceId={spaceIdFromRoomId(id)}
            currentUserId={session.userId}
            currentUserName={session.name}
            lastReadAt={readBefore}
            onToggleReaction={toggleReaction}
            onOpenThread={openThread}
            onEditMessage={editMessage}
            onDeleteMessage={deleteMessage}
            onOpenProfile={openProfile}
            onLoadAttachment={loadAttachment}
            editingId={editingId}
            onEditingChange={setEditingId}
          />
          {/* Publish this room's recent threads to the desktop sidebar (no UI). */}
          <ThreadDigestPublisher store={store} roomId={id} readBefore={readBefore} />
        </>
      ) : (
        <EmptyState iconName="globe" title="Connecting…" />
      )}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.xs, paddingBottom: spacing.md },
  readonly: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.screenX,
    borderTopWidth: 1,
  },
});
