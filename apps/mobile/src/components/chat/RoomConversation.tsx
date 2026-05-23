import { StyleSheet } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';

import { authorFor, dayLabel, isContinuation, sameDay, toDisplayMessage } from '@/lib/message-view';
import { replyCount } from '@/lib/reactions';
import type { AttachmentRef } from '@/lib/starfish/attachments';
import { useConversationData, type ConversationStore } from '@/lib/use-conversation-data';

import { DateDivider, UnreadDivider } from './Dividers';
import { MessageGroup } from './MessageGroup';

/** Rough message-row height; only a virtualization hint before measurement. */
const ESTIMATED_ROW_HEIGHT = 80;

/**
 * Live, decrypted top-level message stream with reactions + thread entry points.
 * Renders through a virtualized {@link LegendList} that opens on the newest
 * message (`initialScrollAtEnd`) and keeps following new ones near the bottom
 * (`maintainScrollAtEnd`). `recycleItems` stays off because {@link MessageGroup}
 * holds per-row hover state.
 */
export function RoomConversation({
  store,
  spaceId,
  currentUserId,
  currentUserName,
  lastReadAt,
  onToggleReaction,
  onOpenThread,
  onEditMessage,
  onDeleteMessage,
  onOpenProfile,
  onLoadAttachment,
  editingId,
  onEditingChange,
}: {
  store: ConversationStore;
  /** Space this room belongs to — resolves `#channel` mentions to links. */
  spaceId?: string;
  currentUserId: string;
  /** The viewer's pseudo — flags messages that `@`-mention them. */
  currentUserName?: string;
  /** The viewer's last-read timestamp for this room (snapshotted before the open
   *  cleared it) — messages newer than it render as unread. */
  lastReadAt?: number;
  onToggleReaction: (msgId: string, emoji: string) => void;
  onOpenThread: (msgId: string) => void;
  /** Edit a message's text (author-gated per row by this component). */
  onEditMessage: (msgId: string, text: string) => void;
  /** Delete a message (author-gated per row by this component). */
  onDeleteMessage: (msgId: string) => void;
  /** Open an author's public profile (avatar/name tap). */
  onOpenProfile?: (userId: string) => void;
  onLoadAttachment?: (ref: AttachmentRef) => Promise<Uint8Array | null>;
  /** Id of the message whose inline editor is open (null = none) — lets the
   *  composer's ArrowUp shortcut open the viewer's last message for editing. */
  editingId?: string | null;
  onEditingChange?: (id: string | null) => void;
}) {
  const { messages, reactions, edits, pseudo, avatar, nameFor, resolveRoom, selfName } = useConversationData(
    store,
    spaceId,
    currentUserId,
    currentUserName,
  );
  const top = messages.filter((m) => !m.parentId);

  return (
    <LegendList
      style={styles.list}
      data={top}
      keyExtractor={(m) => m.id}
      recycleItems={false}
      estimatedItemSize={ESTIMATED_ROW_HEIGHT}
      // Rows are memoized by item data, so a room-level editingId change alone
      // wouldn't re-render the target row; extraData busts that memo so opening
      // a row's inline editor (edit pencil / composer ArrowUp) actually shows.
      extraData={editingId}
      initialScrollAtEnd
      alignItemsAtEnd
      maintainScrollAtEnd
      maintainScrollAtEndThreshold={0.1}
      maintainVisibleContentPosition
      renderItem={({ item: m, index }) => {
        const prev = top[index - 1];
        const rc = replyCount(messages, m.id);
        // A divider opens each new calendar day; the "New" rule fires once, at the
        // first message past the read mark that has a read message above it (so it
        // never lands at the very top of a never-read room).
        const showDate = !prev || !sameDay(prev.ts, m.ts);
        const showUnread = lastReadAt != null && !!prev && prev.ts <= lastReadAt && m.ts > lastReadAt;
        return (
          <>
            {showDate ? <DateDivider date={dayLabel(m.ts)} /> : null}
            {showUnread ? <UnreadDivider /> : null}
            <MessageGroup
              message={toDisplayMessage(m, reactions, currentUserId, { threadCount: rc || undefined, selfName, lastReadAt, edits })}
              author={authorFor(m.authorId, currentUserId, pseudo(m.authorId), avatar(m.authorId))}
              continuation={!showDate && !showUnread && isContinuation(m, prev)}
              nameFor={nameFor}
              resolveRoom={resolveRoom}
              currentUserName={selfName}
              onToggleReaction={(emoji) => onToggleReaction(m.id, emoji)}
              onOpenThread={() => onOpenThread(m.id)}
              onEdit={m.authorId === currentUserId && m.text ? (t) => onEditMessage(m.id, t) : undefined}
              onDelete={m.authorId === currentUserId ? () => onDeleteMessage(m.id) : undefined}
              onPressAuthor={onOpenProfile ? () => onOpenProfile(m.authorId) : undefined}
              onLoadAttachment={onLoadAttachment}
              editing={onEditingChange ? editingId === m.id : undefined}
              onEditingChange={onEditingChange ? (v) => onEditingChange(v ? m.id : null) : undefined}
            />
          </>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
});
