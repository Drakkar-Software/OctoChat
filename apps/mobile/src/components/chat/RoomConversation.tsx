import { useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';

import { authorFor, dayLabel, isContinuation, mergePendingMessages, resolvePinned, sameDay, toDisplayMessage } from '@/lib/message-view';
import type { OutboxMessage } from '@/lib/outbox';
import { replyCounts } from '@/lib/reactions';
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
  onPinMessage,
  ownerId,
  isOwner,
  onOpenProfile,
  onLoadAttachment,
  pending,
  onRetry,
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
  /** Pin/unpin a message — wired only when {@link isOwner}. */
  onPinMessage?: (msgId: string, pin: boolean) => void;
  /** The space owner's id — the only author whose pin events count at fold time. */
  ownerId?: string;
  /** Whether the viewer is the space owner (gates the per-row pin affordance). */
  isOwner?: boolean;
  /** Open an author's public profile (avatar/name tap). */
  onOpenProfile?: (userId: string) => void;
  onLoadAttachment?: (ref: AttachmentRef) => Promise<Uint8Array | null>;
  /** Unsent (offline outbox) messages for THIS room's top level — rendered as muted
   *  pending bubbles after the synced messages (see `src/lib/outbox.ts`). */
  pending?: OutboxMessage[];
  /** Retry a failed pending message by id. */
  onRetry?: (id: string) => void;
  /** Id of the message whose inline editor is open (null = none) — lets the
   *  composer's ArrowUp shortcut open the viewer's last message for editing. */
  editingId?: string | null;
  onEditingChange?: (id: string | null) => void;
}) {
  const { messages, reactions, edits, pins, pseudo, avatar, nameFor, resolveRoom, resolveUser, selfName } = useConversationData(
    store,
    spaceId,
    currentUserId,
    currentUserName,
  );
  // Fold the offline outbox's pending entries in as bubbles (deduped by id against
  // anything already synced) and key them by id → status so each row knows whether
  // it's queued/sending/failed.
  const top = useMemo(
    () => mergePendingMessages(messages, pending ?? []).filter((m) => !m.parentId),
    [messages, pending],
  );
  const pendingStatus = useMemo(() => new Map((pending ?? []).map((e) => [e.id, e.status])), [pending]);

  // LegendList memoizes each row's render by `[itemKey, data, extraData]`, so a row only
  // re-runs `toDisplayMessage` when its own message object changes. Reactions and edits
  // live in SEPARATE arrays folded onto the message at render time, and `editingId` is
  // room-level — none of them touch the message object. Without listing them here, a new
  // reaction/edit (or opening a row's inline editor) would not re-render the target row.
  // Merge-doc rooms hide this because every sync rebuilds message objects (fresh decrypt);
  // stream rooms preserve message identity across delta pulls, so the row would only update
  // on a full re-open (room switch) — hence reactions appearing to need a refresh. These
  // refs change only when their content changes, so an idle pull triggers no re-render.
  // Reply count per parent id. In `extraData` so a new reply (which changes `messages`
  // but NOT the parent row's own object) busts the LegendList row memo — without this a
  // thread's "N replies" badge only updates on a full re-open in stream/automated rooms,
  // which preserve message identity across delta pulls (same memo gap as reactions/edits).
  const threadCounts = useMemo(() => replyCounts(messages), [messages]);
  const extraData = useMemo(
    () => ({ editingId, reactions, edits, pins, ownerId, pendingStatus, threadCounts }),
    [editingId, reactions, edits, pins, ownerId, pendingStatus, threadCounts],
  );

  // When an inline editor opens, lift its row into the keyboard-shrunk viewport. The
  // screen's KeyboardAvoidingView shrinks this list when the editor's input focuses, but
  // doesn't scroll the edited row up — so a row low on screen ends up under the keyboard.
  // Place it ~a third from the top of the (shrunk) list, above the keyboard. Native only:
  // on web the keyboard never overlays, so an edit-click shouldn't jump the scroll. The
  // short delay lets the editor mount + the keyboard frame settle before we measure.
  const listRef = useRef<LegendListRef>(null);
  const topRef = useRef(top);
  topRef.current = top;
  useEffect(() => {
    if (Platform.OS === 'web' || !editingId) return;
    const t = setTimeout(() => {
      const index = topRef.current.findIndex((m) => m.id === editingId);
      if (index >= 0) void listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated: true });
    }, 250);
    return () => clearTimeout(t);
  }, [editingId]);

  return (
    <LegendList
      ref={listRef}
      style={styles.list}
      data={top}
      keyExtractor={(m) => m.id}
      recycleItems={false}
      estimatedItemSize={ESTIMATED_ROW_HEIGHT}
      // Busts LegendList's per-row memo when reactions/edits/editingId change (see above).
      extraData={extraData}
      initialScrollAtEnd
      alignItemsAtEnd
      maintainScrollAtEnd
      maintainScrollAtEndThreshold={0.1}
      maintainVisibleContentPosition
      renderItem={({ item: m, index }) => {
        const prev = top[index - 1];
        const rc = threadCounts.get(m.id) ?? 0;
        // A divider opens each new calendar day; the "New" rule fires once, at the
        // first message past the read mark that has a read message above it (so it
        // never lands at the very top of a never-read room).
        const showDate = !prev || !sameDay(prev.ts, m.ts);
        const showUnread = lastReadAt != null && !!prev && prev.ts <= lastReadAt && m.ts > lastReadAt;
        // A still-unsent message: it isn't on the server yet, so react/reply/edit/
        // delete/pin make no sense — disable them and offer retry (when failed) instead.
        const ps = pendingStatus.get(m.id);
        return (
          <>
            {showDate ? <DateDivider date={dayLabel(m.ts)} /> : null}
            {showUnread ? <UnreadDivider /> : null}
            <MessageGroup
              message={toDisplayMessage(m, reactions, currentUserId, { threadCount: rc || undefined, selfName, lastReadAt, edits, pins, ownerId, pending: ps })}
              author={authorFor(m.authorId, currentUserId, pseudo(m.authorId), avatar(m.authorId))}
              continuation={!showDate && !showUnread && isContinuation(m, prev)}
              nameFor={nameFor}
              resolveRoom={resolveRoom}
              resolveUser={resolveUser}
              onOpenMention={onOpenProfile}
              currentUserName={selfName}
              onToggleReaction={ps ? undefined : (emoji) => onToggleReaction(m.id, emoji)}
              onOpenThread={ps ? undefined : () => onOpenThread(m.id)}
              onEdit={!ps && m.authorId === currentUserId && m.text ? (t) => onEditMessage(m.id, t) : undefined}
              onDelete={!ps && m.authorId === currentUserId ? () => onDeleteMessage(m.id) : undefined}
              onPin={!ps && isOwner && onPinMessage ? () => onPinMessage(m.id, !resolvePinned(pins, m.id, ownerId)) : undefined}
              onRetry={ps === 'failed' && onRetry ? () => onRetry(m.id) : undefined}
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
