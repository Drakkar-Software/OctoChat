import { StyleSheet, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';

import { spacing } from '@/theme';
import { authorFor, toDisplayMessage } from '@/lib/message-view';
import { plural } from '@/lib/format';
import type { AttachmentRef } from '@/lib/starfish/attachments';
import { useConversationData, type ConversationStore } from '@/lib/use-conversation-data';
import { Txt } from '@/components/ui/Txt';

import { MessageGroup } from './MessageGroup';

/** Highlighted parent message + its replies, read from the room's synced store. */
export function ThreadConversation({
  store,
  spaceId,
  parentId,
  currentUserId,
  currentUserName,
  lastReadAt,
  onToggleReaction,
  onEditMessage,
  onDeleteMessage,
  onOpenProfile,
  onLoadAttachment,
}: {
  store: ConversationStore;
  /** Space this thread belongs to — resolves `#channel` mentions to links. */
  spaceId?: string;
  parentId: string;
  currentUserId: string;
  /** The viewer's pseudo — flags messages that `@`-mention them. */
  currentUserName?: string;
  /** The viewer's last-read timestamp for this room — messages newer render unread. */
  lastReadAt?: number;
  onToggleReaction: (msgId: string, emoji: string) => void;
  /** Edit a message's text (author-gated per row by this component). */
  onEditMessage: (msgId: string, text: string) => void;
  /** Delete a message (author-gated per row by this component). */
  onDeleteMessage: (msgId: string) => void;
  /** Open an author's public profile (avatar/name tap). */
  onOpenProfile?: (userId: string) => void;
  onLoadAttachment?: (ref: AttachmentRef) => Promise<Uint8Array | null>;
}) {
  const { messages, reactions, edits, pseudo, avatar, nameFor, resolveRoom, selfName } = useConversationData(
    store,
    spaceId,
    currentUserId,
    currentUserName,
  );
  const parent = messages.find((m) => m.id === parentId);
  const replies = messages.filter((m) => m.parentId === parentId);

  return (
    <LegendList
      style={styles.list}
      data={replies}
      keyExtractor={(r) => r.id}
      // Rows hold per-row hover/edit/reveal state, so recycling them would leak it
      // across replies (mirrors RoomConversation).
      recycleItems={false}
      estimatedItemSize={ESTIMATED_ROW_HEIGHT}
      ListHeaderComponent={
        <>
          {parent ? (
            <MessageGroup
              message={toDisplayMessage(parent, reactions, currentUserId, { selfName, lastReadAt, edits })}
              author={authorFor(parent.authorId, currentUserId, pseudo(parent.authorId), avatar(parent.authorId))}
              nameFor={nameFor}
              resolveRoom={resolveRoom}
              currentUserName={selfName}
              onToggleReaction={(emoji) => onToggleReaction(parent.id, emoji)}
              onEdit={parent.authorId === currentUserId && parent.text ? (t) => onEditMessage(parent.id, t) : undefined}
              onDelete={parent.authorId === currentUserId ? () => onDeleteMessage(parent.id) : undefined}
              onPressAuthor={onOpenProfile ? () => onOpenProfile(parent.authorId) : undefined}
              onLoadAttachment={onLoadAttachment}
              highlighted
            />
          ) : null}
          <View style={styles.label}>
            <Txt variant="micro" weight="bold" mono uppercase tone="inkMuted">
              {plural(replies.length, 'reply', 'replies')}
            </Txt>
          </View>
        </>
      }
      renderItem={({ item: r }) => (
        <MessageGroup
          message={toDisplayMessage(r, reactions, currentUserId, { selfName, lastReadAt, edits })}
          author={authorFor(r.authorId, currentUserId, pseudo(r.authorId), avatar(r.authorId))}
          nameFor={nameFor}
          resolveRoom={resolveRoom}
          currentUserName={selfName}
          onToggleReaction={(emoji) => onToggleReaction(r.id, emoji)}
          onEdit={r.authorId === currentUserId && r.text ? (t) => onEditMessage(r.id, t) : undefined}
          onDelete={r.authorId === currentUserId ? () => onDeleteMessage(r.id) : undefined}
          onPressAuthor={onOpenProfile ? () => onOpenProfile(r.authorId) : undefined}
          onLoadAttachment={onLoadAttachment}
        />
      )}
    />
  );
}

/** Rough message-row height; only a virtualization hint before measurement. */
const ESTIMATED_ROW_HEIGHT = 80;

const styles = StyleSheet.create({
  list: { flex: 1 },
  label: { paddingHorizontal: spacing.screenX, paddingVertical: spacing.sm },
});
