import { StyleSheet, View } from 'react-native';
import { useStarfishData } from '@drakkar.software/starfish-client/zustand';

import { spacing } from '@/theme';
import { authorFor, displayName, toDisplayMessage, type StoredMsg } from '@/lib/message-view';
import { plural } from '@/lib/format';
import type { AttachmentRef } from '@/lib/starfish/attachments';
import type { ReactionEvent } from '@/lib/types';
import { useAvatars, usePseudos } from '@/lib/use-pseudos';
import { Txt } from '@/components/ui/Txt';

import { MessageGroup } from './MessageGroup';

/** Highlighted parent message + its replies, read from the room's synced store. */
export function ThreadConversation({
  store,
  parentId,
  currentUserId,
  onToggleReaction,
  onLoadAttachment,
}: {
  store: Parameters<typeof useStarfishData>[0];
  parentId: string;
  currentUserId: string;
  onToggleReaction: (msgId: string, emoji: string) => void;
  onLoadAttachment?: (ref: AttachmentRef) => Promise<Uint8Array | null>;
}) {
  const messages = (useStarfishData(store, (d) => d.messages as StoredMsg[] | undefined) ?? []) as StoredMsg[];
  const reactions = (useStarfishData(store, (d) => d.reactions as ReactionEvent[] | undefined) ?? []) as ReactionEvent[];
  const parent = messages.find((m) => m.id === parentId);
  const replies = messages.filter((m) => m.parentId === parentId);
  // Resolve names for authors AND reactors, so the "who reacted" tooltip can name them.
  const ids = [...new Set([...messages.map((m) => m.authorId), ...reactions.map((r) => r.userId)])];
  const pseudo = usePseudos(ids);
  const avatar = useAvatars(ids);
  const nameFor = (userId: string) => displayName(userId, currentUserId, pseudo(userId));

  return (
    <View>
      {parent ? (
        <MessageGroup
          message={toDisplayMessage(parent, reactions, currentUserId)}
          author={authorFor(parent.authorId, currentUserId, pseudo(parent.authorId), avatar(parent.authorId))}
          nameFor={nameFor}
          onToggleReaction={(emoji) => onToggleReaction(parent.id, emoji)}
          onLoadAttachment={onLoadAttachment}
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
          author={authorFor(r.authorId, currentUserId, pseudo(r.authorId), avatar(r.authorId))}
          nameFor={nameFor}
          onToggleReaction={(emoji) => onToggleReaction(r.id, emoji)}
          onLoadAttachment={onLoadAttachment}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { paddingHorizontal: spacing.screenX, paddingVertical: spacing.sm },
});
