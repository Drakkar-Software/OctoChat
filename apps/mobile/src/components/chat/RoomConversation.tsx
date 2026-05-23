import { StyleSheet } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { useStarfishData } from '@drakkar.software/starfish-client/zustand';

import { authorFor, displayName, isContinuation, toDisplayMessage, type StoredMsg } from '@/lib/message-view';
import { replyCount } from '@/lib/reactions';
import type { AttachmentRef } from '@/lib/starfish/attachments';
import type { ReactionEvent } from '@/lib/types';
import { useAvatars, usePseudos } from '@/lib/use-pseudos';

import { DateDivider } from './Dividers';
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
  currentUserId,
  onToggleReaction,
  onOpenThread,
  onLoadAttachment,
}: {
  store: Parameters<typeof useStarfishData>[0];
  currentUserId: string;
  onToggleReaction: (msgId: string, emoji: string) => void;
  onOpenThread: (msgId: string) => void;
  onLoadAttachment?: (ref: AttachmentRef) => Promise<Uint8Array | null>;
}) {
  const messages = (useStarfishData(store, (d) => d.messages as StoredMsg[] | undefined) ?? []) as StoredMsg[];
  const reactions = (useStarfishData(store, (d) => d.reactions as ReactionEvent[] | undefined) ?? []) as ReactionEvent[];
  const top = messages.filter((m) => !m.parentId);
  // Resolve names for authors AND reactors, so the "who reacted" tooltip can name them.
  const ids = [...new Set([...messages.map((m) => m.authorId), ...reactions.map((r) => r.userId)])];
  const pseudo = usePseudos(ids);
  const avatar = useAvatars(ids);
  const nameFor = (userId: string) => displayName(userId, currentUserId, pseudo(userId));

  return (
    <LegendList
      style={styles.list}
      data={top}
      keyExtractor={(m) => m.id}
      recycleItems={false}
      estimatedItemSize={ESTIMATED_ROW_HEIGHT}
      ListHeaderComponent={<DateDivider date="Today" />}
      initialScrollAtEnd
      alignItemsAtEnd
      maintainScrollAtEnd
      maintainScrollAtEndThreshold={0.1}
      maintainVisibleContentPosition
      renderItem={({ item: m, index }) => {
        const rc = replyCount(messages, m.id);
        return (
          <MessageGroup
            message={toDisplayMessage(m, reactions, currentUserId, rc || undefined)}
            author={authorFor(m.authorId, currentUserId, pseudo(m.authorId), avatar(m.authorId))}
            continuation={isContinuation(m, top[index - 1])}
            nameFor={nameFor}
            onToggleReaction={(emoji) => onToggleReaction(m.id, emoji)}
            onOpenThread={() => onOpenThread(m.id)}
            onLoadAttachment={onLoadAttachment}
          />
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
});
