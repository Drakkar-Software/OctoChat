import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';

import { spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { useRoom } from '@/lib/use-room';
import { useTheme } from '@/lib/use-theme';
import type { RoomKind } from '@/lib/types';
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
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ id: string; name?: string; kind?: string }>();
  const id = params.id;
  const name = params.name ?? id;
  const kind = (params.kind ?? 'channel') as RoomKind;
  const { session } = useSession();
  const { store, opening, openError, syncError, send, toggleReaction, uploadAttachment, loadAttachment } = useRoom(id);
  const title = kind === 'dm' ? name : `#${name}`;

  const openThread = (msgId: string) =>
    router.push({ pathname: '/thread/[id]', params: { id: msgId, roomId: id, roomName: name } });
  const openMembers = () => router.push({ pathname: '/members/[id]', params: { id, name } });
  const openSearch = () => router.push('/(tabs)/search');

  return (
    <StackScreen
      scroll
      contentStyle={styles.content}
      header={
        <AppBar
          title={title}
          onBack={() => router.back()}
          subtitle={
            <>
              <Icon name="lock" size={10} color={colors.accent} />
              <Txt variant="caption" tone="inkMuted">
                e2ee · synced
              </Txt>
            </>
          }
          right={
            <>
              <IconButton name="search" accessibilityLabel="Search in room" onPress={openSearch} />
              <IconButton name="people" accessibilityLabel="Members" onPress={openMembers} />
            </>
          }
        />
      }
      desktopHeader={<DesktopChatTopbar name={name} kind={kind} onSearch={openSearch} onMembers={openMembers} />}
      footer={
        <Composer
          placeholder={`Message ${title}`}
          onSend={async (t, file) => {
            const ref = file ? await uploadAttachment(file.bytes, file.name, file.mime) : null;
            send(t, undefined, ref ?? undefined);
          }}
        />
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
});
