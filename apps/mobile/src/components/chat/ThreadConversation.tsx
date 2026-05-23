import { StyleSheet, View } from 'react-native';
import { useStarfishData } from '@drakkar.software/starfish-client/zustand';

import { spacing } from '@/theme';
import { authorFor, displayName, toDisplayMessage, type StoredMsg } from '@/lib/message-view';
import { plural } from '@/lib/format';
import type { AttachmentRef } from '@/lib/starfish/attachments';
import type { MessageEditEvent, ReactionEvent } from '@/lib/types';
import { useAvatars, usePseudos } from '@/lib/use-pseudos';
import { useRoomMentions } from '@/lib/use-room-mentions';
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
  store: Parameters<typeof useStarfishData>[0];
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
  const messages = (useStarfishData(store, (d) => d.messages as StoredMsg[] | undefined) ?? []) as StoredMsg[];
  const reactions = (useStarfishData(store, (d) => d.reactions as ReactionEvent[] | undefined) ?? []) as ReactionEvent[];
  const edits = (useStarfishData(store, (d) => d.edits as MessageEditEvent[] | undefined) ?? []) as MessageEditEvent[];
  const parent = messages.find((m) => m.id === parentId);
  const replies = messages.filter((m) => m.parentId === parentId);
  // Resolve names for authors AND reactors, so the "who reacted" tooltip can name
  // them; include the viewer so their own pseudo resolves for @mention matching.
  const ids = [...new Set([currentUserId, ...messages.map((m) => m.authorId), ...reactions.map((r) => r.userId)])];
  const pseudo = usePseudos(ids);
  const avatar = useAvatars(ids);
  const nameFor = (userId: string) => displayName(userId, currentUserId, pseudo(userId));
  const resolveRoom = useRoomMentions(spaceId ?? null);
  const selfName = pseudo(currentUserId)?.trim() || currentUserName;

  return (
    <View>
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
      {replies.map((r) => (
        <MessageGroup
          key={r.id}
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
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { paddingHorizontal: spacing.screenX, paddingVertical: spacing.sm },
});
