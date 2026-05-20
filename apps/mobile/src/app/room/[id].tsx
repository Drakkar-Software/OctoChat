import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { getMessages, getRoom, getThreadForMessage, getUser } from '@/lib/placeholder-data';
import { useTheme } from '@/lib/use-theme';
import { AppBar } from '@/components/ui/AppBar';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';
import { Composer } from '@/components/chat/Composer';
import { DateDivider, UnreadDivider } from '@/components/chat/Dividers';
import { MessageGroup } from '@/components/chat/MessageGroup';

export default function RoomScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const room = getRoom(id);
  const messages = getMessages(room.id);
  const title = room.kind === 'dm' ? room.name : `#${room.name}`;

  const openThread = (messageId: string) => {
    const thread = getThreadForMessage(messageId);
    if (thread) router.push({ pathname: '/thread/[id]', params: { id: thread.id } });
  };

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
                e2ee · {room.kind === 'dm' ? 'direct' : '14'}
              </Txt>
            </>
          }
          right={
            <>
              <IconButton name="search" accessibilityLabel="Search in room" />
              <IconButton name="dots" accessibilityLabel="Room options" />
            </>
          }
        />
      }
      footer={<Composer placeholder={`Message ${title}`} />}
    >
      <DateDivider date="Today" />
      {messages.map((m) => (
        <View key={m.id}>
          {m.unreadBefore ? <UnreadDivider /> : null}
          <MessageGroup message={m} author={getUser(m.authorId)} onOpenThread={() => openThread(m.id)} />
        </View>
      ))}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.xs, paddingBottom: spacing.md },
});
