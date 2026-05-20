import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { getParentMessage, getRoom, getThread, getUser } from '@/lib/placeholder-data';
import { useTheme } from '@/lib/use-theme';
import { AppBar } from '@/components/ui/AppBar';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';
import { Composer } from '@/components/chat/Composer';
import { MessageGroup } from '@/components/chat/MessageGroup';

export default function ThreadScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const thread = getThread(id);
  const room = getRoom(thread.roomId);
  const parent = getParentMessage(thread);
  const [alsoSend, setAlsoSend] = useState(false);

  const footer = (
    <View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: alsoSend }}
        onPress={() => setAlsoSend((v) => !v)}
        style={styles.alsoRow}
      >
        <View
          style={[
            styles.box,
            { borderColor: alsoSend ? colors.accent : colors.lineSoft, backgroundColor: alsoSend ? colors.accent : 'transparent' },
          ]}
        >
          {alsoSend ? <Icon name="check" size={11} color={colors.onAccent} /> : null}
        </View>
        <Txt variant="footnote" tone="inkMuted">
          Also send to #{room.name}
        </Txt>
      </Pressable>
      <Composer placeholder="Reply in thread…" />
    </View>
  );

  return (
    <StackScreen
      scroll
      contentStyle={styles.content}
      header={
        <AppBar
          title="Thread"
          subtitle={`#${room.name} · ${thread.replies.length} replies`}
          onBack={() => router.back()}
          right={<IconButton name="dots" accessibilityLabel="Thread options" />}
        />
      }
      footer={footer}
    >
      <MessageGroup message={parent} author={getUser(parent.authorId)} highlighted />
      <View style={styles.replyLabel}>
        <Txt variant="micro" weight="bold" mono uppercase tone="inkMuted">
          {thread.replies.length} replies
        </Txt>
      </View>
      {thread.replies.map((r) => (
        <MessageGroup key={r.id} message={r} author={getUser(r.authorId)} />
      ))}
    </StackScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.sm, paddingBottom: spacing.md },
  alsoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  box: {
    width: 18,
    height: 18,
    borderRadius: radii.xs,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyLabel: { paddingHorizontal: spacing.screenX, paddingVertical: spacing.sm },
});
