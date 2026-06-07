import { createStore } from 'zustand';
import { useStarfishData } from '@drakkar.software/starfish-client/zustand';

import { matchesUser } from './links';
import { displayName, type StoredMsg } from '@drakkar.software/octochat-sdk';
import type { MessageEditEvent, PinEvent, ReactionEvent } from '@drakkar.software/octochat-sdk';
import { useAvatars, usePseudos } from './use-pseudos';
import { useRoomMentions } from './use-room-mentions';

/** A synced room store handle (the zustand store `useStarfishData` reads from). */
export type ConversationStore = Parameters<typeof useStarfishData>[0];

/** A minimal zustand store whose `.data` the chat UI reads via `useStarfishData`.
 *  Only `data` is consumed; the StarfishStore action/flag fields are inert stubs to
 *  satisfy the `ConversationStore` type without the SDK's sync machinery. Used as the
 *  always-present store for STREAM rooms (append-only, no SDK store) and as the empty
 *  OFFLINE FALLBACK for a merge-doc room whose SDK store can't open without the network
 *  — so the conversation view (and its pending outbox bubbles) still renders offline. */
export function makeEmptyConversationStore(): ConversationStore {
  return createStore(() => ({
    data: { messages: [], reactions: [], edits: [], pins: [] },
    syncing: false,
    online: true,
    dirty: false,
    error: null,
    hash: null,
    stale: false,
    pull: async () => {},
    set: () => {},
    restore: () => {},
    flush: async () => {},
    setOnline: () => {},
    seed: async () => {},
  })) as unknown as ConversationStore;
}

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
  const pins = (useStarfishData(store, (d) => d.pins as PinEvent[] | undefined) ?? []) as PinEvent[];
  // Resolve names for authors AND reactors, so the "who reacted" tooltip can name
  // them; include the viewer so their own pseudo resolves for @mention matching.
  const ids = [...new Set([currentUserId, ...messages.map((m) => m.authorId), ...reactions.map((r) => r.userId)])];
  const pseudo = usePseudos(ids);
  const avatar = useAvatars(ids);
  const nameFor = (userId: string) => displayName(userId, currentUserId, pseudo(userId));
  const resolveRoom = useRoomMentions(spaceId ?? null);
  // Prefer the live pseudo (reflects a profile edit) over the prop fallback.
  const selfName = pseudo(currentUserId)?.trim() || currentUserName;
  // Reverse of `pseudo`: map an `@mention` token back to a user id so the mention
  // can open that user's profile, the same way tapping an author name does. Scoped
  // to `ids` (authors/reactors/self in the loaded window) — exactly the users whose
  // names already resolve in the view, so a mention turns clickable on the same tick
  // its author name does. A mention of someone who hasn't posted/reacted here stays
  // inert (their pseudo was never fetched). `selfName` covers self, whose own pseudo
  // lags; on a first-name collision `.find` takes the first match (see `matchesUser`).
  const resolveUser = (name: string): string | undefined =>
    ids.find((id) => matchesUser(name, id === currentUserId ? selfName : pseudo(id)));

  return { messages, reactions, edits, pins, pseudo, avatar, nameFor, resolveRoom, resolveUser, selfName };
}
