import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { useRoom } from '@/lib/use-room';
import { useTheme } from '@/lib/use-theme';
import { AppBar } from '@/components/ui/AppBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { StackScreen } from '@/components/ui/StackScreen';
import { Txt } from '@/components/ui/Txt';
import { Composer } from '@/components/chat/Composer';
import { ThreadConversation } from '@/components/chat/ThreadConversation';

export default function ThreadScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ id: string; roomId: string; roomName?: string }>();
  const parentId = params.id;
  const roomId = params.roomId;
  const roomName = params.roomName ?? roomId;
  const { session } = useSession();
  const { store, opening, openError, send, toggleReaction, uploadAttachment, loadAttachment } = useRoom(roomId);
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
          Also send to #{roomName}
        </Txt>
      </Pressable>
      <Composer
        placeholder="Reply in thread…"
        onSend={async (t, file) => {
          const ref = file ? await uploadAttachment(file.bytes, file.name, file.mime) : null;
          send(t, parentId, ref ?? undefined);
        }}
      />
    </View>
  );

  return (
    <StackScreen
      scroll
      contentStyle={styles.content}
      header={<AppBar title="Thread" subtitle={`#${roomName}`} onBack={() => router.back()} right={<IconButton name="dots" accessibilityLabel="Thread options" />} />}
      footer={footer}
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
          parentId={parentId}
          currentUserId={session.userId}
          onToggleReaction={toggleReaction}
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
  alsoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  box: { width: 18, height: 18, borderRadius: radii.xs, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
