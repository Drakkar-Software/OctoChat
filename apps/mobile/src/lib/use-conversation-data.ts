import { useStarfishData } from '@drakkar.software/starfish-client/zustand';

import { displayName, type StoredMsg } from './message-view';
import type { MessageEditEvent, ReactionEvent } from './types';
import { useAvatars, usePseudos } from './use-pseudos';
import { useRoomMentions } from './use-room-mentions';

/** A synced room store handle (the zustand store `useStarfishData` reads from). */
export type ConversationStore = Parameters<typeof useStarfishData>[0];

/**
 * Reads a room's synced message log and the lookups every conversation view needs
 * — the decrypted `messages`/`reactions`/`edits`, plus resolvers for author names,
 * avatars, `#channel` mentions, and the viewer's own pseudo. Shared by
 * {@link RoomConversation} (top-level stream) and {@link ThreadConversation}
 * (parent + replies) so the two never drift on how they resolve identities.
 *
 * `pseudo`/`avatar` resolve ids to the live profile, falling back to the prop
 * `currentUserName` for the viewer until their own pseudo arrives.
 */
export function useConversationData(
  store: ConversationStore,
  spaceId: string | undefined,
  currentUserId: string,
  currentUserName?: string,
) {
  const messages = (useStarfishData(store, (d) => d.messages as StoredMsg[] | undefined) ?? []) as StoredMsg[];
  const reactions = (useStarfishData(store, (d) => d.reactions as ReactionEvent[] | undefined) ?? []) as ReactionEvent[];
  const edits = (useStarfishData(store, (d) => d.edits as MessageEditEvent[] | undefined) ?? []) as MessageEditEvent[];
  // Resolve names for authors AND reactors, so the "who reacted" tooltip can name
  // them; include the viewer so their own pseudo resolves for @mention matching.
  const ids = [...new Set([currentUserId, ...messages.map((m) => m.authorId), ...reactions.map((r) => r.userId)])];
  const pseudo = usePseudos(ids);
  const avatar = useAvatars(ids);
  const nameFor = (userId: string) => displayName(userId, currentUserId, pseudo(userId));
  const resolveRoom = useRoomMentions(spaceId ?? null);
  // Prefer the live pseudo (reflects a profile edit) over the prop fallback.
  const selfName = pseudo(currentUserId)?.trim() || currentUserName;

  return { messages, reactions, edits, pseudo, avatar, nameFor, resolveRoom, selfName };
}
