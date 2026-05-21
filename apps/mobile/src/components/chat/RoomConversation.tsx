import { View } from 'react-native';
import { useStarfishData } from '@drakkar.software/starfish-client/zustand';

import { authorFor, displayName, toDisplayMessage, type StoredMsg } from '@/lib/message-view';
import { replyCount } from '@/lib/reactions';
import type { AttachmentRef } from '@/lib/starfish/attachments';
import type { ReactionEvent } from '@/lib/types';
import { useAvatars, usePseudos } from '@/lib/use-pseudos';

import { DateDivider } from './Dividers';
import { MessageGroup } from './MessageGroup';

/** Live, decrypted top-level message stream with reactions + thread entry points. */
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
    <View>
      <DateDivider date="Today" />
      {top.map((m) => {
        const rc = replyCount(messages, m.id);
        return (
          <MessageGroup
            key={m.id}
            message={toDisplayMessage(m, reactions, currentUserId, rc || undefined)}
            author={authorFor(m.authorId, currentUserId, pseudo(m.authorId), avatar(m.authorId))}
            nameFor={nameFor}
            onToggleReaction={(emoji) => onToggleReaction(m.id, emoji)}
            onOpenThread={() => onOpenThread(m.id)}
            onLoadAttachment={onLoadAttachment}
          />
        );
      })}
    </View>
  );
}
