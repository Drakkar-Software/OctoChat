import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';

import { spacing } from '@/theme';
import { authorFor, dayLabel, isContinuation, mergePendingMessages, resolvePinned, sameDay, toDisplayMessage } from '@/lib/message-view';
import type { OutboxMessage } from '@/lib/outbox';
import { plural } from '@/lib/format';
import type { AttachmentRef } from '@/lib/starfish/attachments';
import { useConversationData, type ConversationStore } from '@/lib/use-conversation-data';
import { Txt } from '@/components/ui/Txt';

import { DateDivider, UnreadDivider } from './Dividers';
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
  onPinMessage,
  ownerId,
  isOwner,
  onOpenProfile,
  onLoadAttachment,
  pending,
  onRetry,
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
  /** Pin/unpin a message — wired only when {@link isOwner}. */
  onPinMessage?: (msgId: string, pin: boolean) => void;
  /** The space owner's id — the only author whose pin events count at fold time. */
  ownerId?: string;
  /** Whether the viewer is the space owner (gates the per-row pin affordance). */
  isOwner?: boolean;
  /** Open an author's public profile (avatar/name tap). */
  onOpenProfile?: (userId: string) => void;
  onLoadAttachment?: (ref: AttachmentRef) => Promise<Uint8Array | null>;
  /** Unsent (offline outbox) replies for THIS thread — rendered as muted pending
   *  bubbles after the synced replies (see `src/lib/outbox.ts`). */
  pending?: OutboxMessage[];
  /** Retry a failed pending reply by id. */
  onRetry?: (id: string) => void;
}) {
  const { messages, reactions, edits, pins, pseudo, avatar, nameFor, resolveRoom, resolveUser, selfName } = useConversationData(
    store,
    spaceId,
    currentUserId,
    currentUserName,
  );
  const parent = messages.find((m) => m.id === parentId);
  // Fold this thread's pending (offline) replies in as bubbles, deduped by id.
  const replies = useMemo(
    () => mergePendingMessages(messages.filter((m) => m.parentId === parentId), pending ?? []),
    [messages, parentId, pending],
  );
  const pendingStatus = useMemo(() => new Map((pending ?? []).map((e) => [e.id, e.status])), [pending]);
  const pinHandler = (msgId: string) =>
    isOwner && onPinMessage ? () => onPinMessage(msgId, !resolvePinned(pins, msgId, ownerId)) : undefined;
  // LegendList memoizes each reply row by `[itemKey, data, extraData]`; reactions/edits
  // are folded onto the message at render from separate arrays, so without listing them
  // a new reaction/edit on a reply wouldn't re-render its row until a full re-open. Refs
  // change only on content change, so idle pulls cause no re-render (mirrors RoomConversation).
  const extraData = useMemo(
    () => ({ reactions, edits, pins, ownerId, pendingStatus }),
    [reactions, edits, pins, ownerId, pendingStatus],
  );

  return (
    <LegendList
      style={styles.list}
      data={replies}
      keyExtractor={(r) => r.id}
      // Rows hold per-row hover/edit/reveal state, so recycling them would leak it
      // across replies (mirrors RoomConversation).
      recycleItems={false}
      extraData={extraData}
      estimatedItemSize={ESTIMATED_ROW_HEIGHT}
      // Open on the newest reply, then follow new ones near the bottom and hold the
      // viewport steady on updates/prepends — mirrors RoomConversation. `initialScrollAtEnd`
      // is required for the open-at-end jump (maintainScrollAtEnd alone misses it on
      // web's initial mount); `alignItemsAtEnd` pins a short thread to the bottom.
      initialScrollAtEnd
      alignItemsAtEnd
      maintainScrollAtEnd
      maintainScrollAtEndThreshold={0.1}
      maintainVisibleContentPosition
      ListHeaderComponent={
        <>
          {parent ? (
            <MessageGroup
              message={toDisplayMessage(parent, reactions, currentUserId, { selfName, lastReadAt, edits, pins, ownerId })}
              author={authorFor(parent.authorId, currentUserId, pseudo(parent.authorId), avatar(parent.authorId))}
              nameFor={nameFor}
              resolveRoom={resolveRoom}
              resolveUser={resolveUser}
              onOpenMention={onOpenProfile}
              currentUserName={selfName}
              onToggleReaction={(emoji) => onToggleReaction(parent.id, emoji)}
              onEdit={parent.authorId === currentUserId && parent.text ? (t) => onEditMessage(parent.id, t) : undefined}
              onDelete={parent.authorId === currentUserId ? () => onDeleteMessage(parent.id) : undefined}
              onPin={pinHandler(parent.id)}
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
      renderItem={({ item: r, index }) => {
        // Group consecutive replies exactly like RoomConversation: a divider opens
        // each new calendar day and the "New" rule fires once at the first reply past
        // the read mark. `prev` is the previous reply only — the first reply never
        // continues the parent (the "N replies" label sits between them).
        const prev = replies[index - 1];
        const showDate = !prev || !sameDay(prev.ts, r.ts);
        const showUnread = lastReadAt != null && !!prev && prev.ts <= lastReadAt && r.ts > lastReadAt;
        const ps = pendingStatus.get(r.id);
        return (
          <>
            {showDate ? <DateDivider date={dayLabel(r.ts)} /> : null}
            {showUnread ? <UnreadDivider /> : null}
            <MessageGroup
              message={toDisplayMessage(r, reactions, currentUserId, { selfName, lastReadAt, edits, pins, ownerId, pending: ps })}
              author={authorFor(r.authorId, currentUserId, pseudo(r.authorId), avatar(r.authorId))}
              continuation={!showDate && !showUnread && isContinuation(r, prev)}
              nameFor={nameFor}
              resolveRoom={resolveRoom}
              resolveUser={resolveUser}
              onOpenMention={onOpenProfile}
              currentUserName={selfName}
              onToggleReaction={ps ? undefined : (emoji) => onToggleReaction(r.id, emoji)}
              onEdit={!ps && r.authorId === currentUserId && r.text ? (t) => onEditMessage(r.id, t) : undefined}
              onDelete={!ps && r.authorId === currentUserId ? () => onDeleteMessage(r.id) : undefined}
              onPin={ps ? undefined : pinHandler(r.id)}
              onRetry={ps === 'failed' && onRetry ? () => onRetry(r.id) : undefined}
              onPressAuthor={onOpenProfile ? () => onOpenProfile(r.authorId) : undefined}
              onLoadAttachment={onLoadAttachment}
            />
          </>
        );
      }}
    />
  );
}

/** Rough message-row height; only a virtualization hint before measurement. */
const ESTIMATED_ROW_HEIGHT = 80;

const styles = StyleSheet.create({
  list: { flex: 1 },
  label: { paddingHorizontal: spacing.screenX, paddingVertical: spacing.sm },
});
