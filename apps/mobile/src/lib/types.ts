/** Domain model for OctoChat. Frontend-only — these describe placeholder data. */

import type { PresenceStatus, VerificationLevel } from '@/theme';
import type { AttachmentRef } from './starfish/attachments';

export type ID = string;

export interface User {
  id: ID;
  name: string;
  handle: string;
  initials: string;
  presence?: PresenceStatus;
  /** Uploaded avatar as a data URI; absent → render the monogram initials. */
  avatar?: string;
}

export interface Space {
  id: ID;
  name: string;
  /** 2-letter monogram used in the space rail. */
  short: string;
  members: number;
  unread?: number;
  /** 'private' (E2EE keyring space, the default) or 'public' (plaintext, joined via
   *  a space-wide invitation link). Absent ⇒ treat as 'private' (back-compat). */
  type?: 'private' | 'public';
  /** Public spaces only: the owner's userId (the cap issuer + storage path owner). */
  ownerId?: string;
  /** Public spaces only (joiner side): whether this identity's invite link grants
   *  write. Owner always has write. */
  write?: boolean;
}

export type RoomKind = 'channel' | 'private' | 'dm';

export interface Room {
  id: ID;
  spaceId: ID;
  /** Category bucket this room renders under (e.g. "DESIGN"). */
  category: string;
  name: string;
  kind: RoomKind;
  topic?: string;
  unread?: number;
  mention?: boolean;
  /** DM avatar monogram. */
  avatar?: string;
}

export interface Reaction {
  emoji: string;
  count: number;
  mine?: boolean;
  /** Ids of the users currently reacting with this emoji (for the "who reacted"
   *  tooltip). Raw ids — names are resolved at render so they stay viewer-aware. */
  userIds: string[];
}

/** Append-only reaction event stored in the room doc; aggregated for display. */
export interface ReactionEvent {
  id: string;
  msgId: string;
  emoji: string;
  userId: string;
  kind: 'add' | 'remove';
  ts: number;
}

export type Attachment =
  | { kind: 'image'; label: string; ratio: number }
  | { kind: 'video'; label: string; duration: string }
  | { kind: 'file'; name: string; meta: string }
  | { kind: 'link'; title: string; domain: string; blurb: string };

export interface Message {
  id: ID;
  roomId: ID;
  authorId: ID;
  time: string;
  text?: string;
  attachment?: Attachment;
  /** Real (encrypted) attachment reference rendered via AttachmentView. */
  attachmentRef?: AttachmentRef;
  reactions?: Reaction[];
  /** Number of replies if this message anchors a thread. */
  threadCount?: number;
  /** Whether this message @-mentions the current user. */
  mention?: boolean;
  /** Render an "unread" divider above this message. */
  unreadBefore?: boolean;
}

export interface Thread {
  id: ID;
  roomId: ID;
  parentId: ID;
  replies: Message[];
}

export interface SecurityItem {
  id: ID;
  icon: 'shield' | 'devices' | 'key';
  title: string;
  detail: string;
  level: VerificationLevel;
  mono?: boolean;
}

export interface Profile {
  user: User;
  pronouns: string;
  description: string;
  status: string;
  fingerprint: string;
  security: SecurityItem[];
}
