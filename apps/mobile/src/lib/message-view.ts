import { aggregateReactions } from './reactions';
import type { AttachmentRef } from './starfish/attachments';
import type { Message, ReactionEvent, User } from './types';

/** Shape of a message as stored (encrypted) in a room document. */
export interface StoredMsg {
  id: string;
  authorId: string;
  text?: string;
  ts: number;
  parentId?: string;
  attachment?: AttachmentRef;
}

/** A user's display label: "You" for the viewer, else the resolved pseudo, else
 *  the hex id prefix until a pseudo arrives. Used for authors and reactors. */
export function displayName(userId: string, currentUserId: string, pseudo?: string): string {
  if (userId === currentUserId) return 'You';
  return pseudo?.trim() || userId.slice(0, 8);
}

export function authorFor(authorId: string, currentUserId: string, pseudo?: string): User {
  // Prefer the profile pseudo; fall back to the hex prefix until one resolves.
  // `initials` follows the resolved name for everyone (incl. me) so avatars stay consistent.
  const named = pseudo?.trim();
  const display = named || authorId.slice(0, 8);
  return {
    id: authorId,
    name: displayName(authorId, currentUserId, pseudo),
    handle: named ? `@${named}` : `@${authorId.slice(0, 6)}`,
    initials: display.slice(0, 2).toUpperCase(),
  };
}

export function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Map a stored message → the display `Message` the UI components expect. */
export function toDisplayMessage(
  m: StoredMsg,
  reactions: ReactionEvent[],
  currentUserId: string,
  threadCount?: number,
): Message {
  return {
    id: m.id,
    roomId: '',
    authorId: m.authorId,
    time: hhmm(m.ts),
    text: m.text,
    attachmentRef: m.attachment,
    reactions: aggregateReactions(reactions, m.id, currentUserId),
    threadCount,
  };
}
