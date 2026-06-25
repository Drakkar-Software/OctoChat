import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';

import { spacing } from '@/theme';
import {
  authorFor,
  buildMessageIndex,
  dayLabel,
  isContinuation,
  mergePendingMessages,
  sameDay,
  toDisplayMessageIndexed,
} from '@drakkar.software/octochat-sdk';
import type { OutboxMessage } from '@/lib/outbox';
import { plural } from '@drakkar.software/octochat-sdk';
import type { AttachmentRef } from '@drakkar.software/octochat-sdk';
import { useConversationData, type ConversationStore } from '@/lib/use-conversation-data';
import { useTheme } from '@/lib/use-theme';
import { Txt } from '@/components/ui/Txt';

import { DateDivider, UnreadDivider } from './Dividers';
import { MessageGroup } from './MessageGroup';
import { ThreadParentCard } from './ThreadParentCard';

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
  const { colors } = useTheme();
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
  // Build a precomputed index for reactions/edits/pins in O(N) single passes instead
  // of O(N·events) per-row scans. Mirrors the pattern in RoomConversation.
  const msgIdx = useMemo(
    () => buildMessageIndex(messages, reactions, edits, pins, currentUserId, ownerId),
    [messages, reactions, edits, pins, currentUserId, ownerId],
  );
  const pinHandler = (msgId: string) =>
    isOwner && onPinMessage ? () => onPinMessage(msgId, !msgIdx.pinned.has(msgId)) : undefined;
  // LegendList memoizes each reply row by `[itemKey, data, extraData]`; without listing
  // msgIdx here, a new reaction/edit on a reply wouldn't re-render its row until a full
  // re-open. msgIdx changes only when reactions/edits/pins change, so idle pulls are no-ops.
  const extraData = useMemo(
    () => ({ msgIdx, pendingStatus }),
    [msgIdx, pendingStatus],
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
            // The parent is the thread's origin: frame it in an accent anchor card
            // (own identity) rather than the generic highlighted-mention tint, so it
            // reads as a branched side-conversation, not a slightly-tinted room.
            <ThreadParentCard>
              <MessageGroup
                message={toDisplayMessageIndexed(parent, msgIdx, currentUserId, { selfName, lastReadAt })}
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
              />
            </ThreadParentCard>
          ) : null}
          <View style={styles.label}>
            <View style={[styles.labelRule, { backgroundColor: colors.ruleSoft }]} />
            <Txt variant="micro" weight="bold" mono uppercase tone="inkMuted">
              {plural(replies.length, 'reply', 'replies')}
            </Txt>
            <View style={[styles.labelRule, { backgroundColor: colors.ruleSoft }]} />
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
              message={toDisplayMessageIndexed(r, msgIdx, currentUserId, { selfName, lastReadAt, pending: ps })}
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
  // "N replies" rule that separates the anchor card from the reply stream — flanked
  // by a hairline so it reads as a deliberate divider, not a stray label.
  label: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.screenX,
    paddingVertical: spacing.md,
  },
  labelRule: { flex: 1, height: StyleSheet.hairlineWidth },
});
