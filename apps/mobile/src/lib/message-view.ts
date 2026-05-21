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

export function authorFor(authorId: string, currentUserId: string): User {
  const me = authorId === currentUserId;
  return {
    id: authorId,
    name: me ? 'You' : authorId.slice(0, 8),
    handle: `@${authorId.slice(0, 6)}`,
    initials: authorId.slice(0, 2).toUpperCase(),
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
