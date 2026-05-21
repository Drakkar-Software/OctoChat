import { StyleSheet, View } from 'react-native';
import { useStarfishData } from '@drakkar.software/starfish-client/zustand';

import { spacing } from '@/theme';
import { authorFor, toDisplayMessage, type StoredMsg } from '@/lib/message-view';
import { plural } from '@/lib/format';
import type { ReactionEvent } from '@/lib/types';
import { Txt } from '@/components/ui/Txt';

import { MessageGroup } from './MessageGroup';

/** Highlighted parent message + its replies, read from the room's synced store. */
export function ThreadConversation({
  store,
  parentId,
  currentUserId,
  onToggleReaction,
}: {
  store: Parameters<typeof useStarfishData>[0];
  parentId: string;
  currentUserId: string;
  onToggleReaction: (msgId: string, emoji: string) => void;
}) {
  const messages = (useStarfishData(store, (d) => d.messages as StoredMsg[] | undefined) ?? []) as StoredMsg[];
  const reactions = (useStarfishData(store, (d) => d.reactions as ReactionEvent[] | undefined) ?? []) as ReactionEvent[];
  const parent = messages.find((m) => m.id === parentId);
  const replies = messages.filter((m) => m.parentId === parentId);

  return (
    <View>
      {parent ? (
        <MessageGroup
          message={toDisplayMessage(parent, reactions, currentUserId)}
          author={authorFor(parent.authorId, currentUserId)}
          onToggleReaction={(emoji) => onToggleReaction(parent.id, emoji)}
          highlighted
        />
      ) : null}
      <View style={styles.label}>
        <Txt variant="micro" weight="bold" mono uppercase tone="inkMuted">
          {plural(replies.length, 'reply', 'replies')}
        </Txt>
      </View>
      {replies.map((r) => (
        <MessageGroup
          key={r.id}
          message={toDisplayMessage(r, reactions, currentUserId)}
          author={authorFor(r.authorId, currentUserId)}
          onToggleReaction={(emoji) => onToggleReaction(r.id, emoji)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { paddingHorizontal: spacing.screenX, paddingVertical: spacing.sm },
});
