import { useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
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

export default function RoomScreen() {
  const params = useLocalSearchParams<{ id: string; name?: string; kind?: string }>();
  const id = params.id;
  const name = params.name ?? id;
  const kind = (params.kind ?? 'channel') as RoomKind;
  const { colors } = useTheme();
  const { session } = useSession();
  const { markRoomRead } = useUnread();
  const { store, opening, openError, syncError, send, toggleReaction, uploadAttachment, loadAttachment, canWrite } =
    useRoom(id);
  const title = kind === 'dm' ? name : `#${name}`;

  // Clear this room's unread on open. While it's the active room the unread
  // provider already ignores its SSE events, so no live re-marking is needed.
  useEffect(() => {
    if (session) markRoomRead(id);
  }, [session, id, markRoomRead]);

  const openThread = (msgId: string) =>
    router.push({ pathname: '/thread/[id]', params: { id: msgId, roomId: id, roomName: name } });
  const openMembers = () => router.push({ pathname: '/space/[id]', params: { id: spaceIdFromRoomId(id) } });
  const openSearch = () => router.push('/(tabs)/search');

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
            onSend={async (t, file) => {
              const ref = file ? await uploadAttachment(file.bytes, file.name, file.mime) : null;
              send(t, undefined, ref ?? undefined);
            }}
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
            currentUserId={session.userId}
            onToggleReaction={toggleReaction}
            onOpenThread={openThread}
            onLoadAttachment={loadAttachment}
          />
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
