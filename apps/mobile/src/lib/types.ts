/** Domain model for OctoChat. Frontend-only — these describe placeholder data. */

import type { PresenceStatus, VerificationLevel } from '@/theme';
import type { AttachmentRef } from './starfish/attachments';

export type ID = string;

/** Maps a joined private space's id → its owner-issued member cap-cert (serialized
 *  JSON). Persisted both in device-local kv (`member-caps.ts`) and, for durability,
 *  in the user's own synced `_spaces` doc so a fresh device re-hydrates it. */
export type CapMap = Record<string, string>;

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
  /** Uploaded space image as a data URI; absent → render the `short` monogram.
   *  Owner-set + shared via the space's `_rooms` registry (plaintext, NOT E2EE). */
  image?: string;
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

/** `stream` is an append-only room (a "Stream room"): writers append to a log —
 *  no pull/merge/hash — so bots/integrations can post without the sync protocol.
 *  Its encryption follows the space (E2EE private / plaintext public). */
export type RoomKind = 'channel' | 'private' | 'dm' | 'stream';

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

/** Append-only message-edit event stored in the room doc; the latest one (by `ts`)
 *  authored by the message's author wins at render — see `resolveEdit`. A `delete`
 *  tombstones the message; an `edit` carries the replacement `text`. */
export interface MessageEditEvent {
  id: string;
  msgId: string;
  userId: string;
  kind: 'edit' | 'delete';
  /** Replacement body for an `edit`; absent for a `delete`. */
  text?: string;
  ts: number;
}

export interface Message {
  id: ID;
  roomId: ID;
  authorId: ID;
  time: string;
  text?: string;
  /** Real (encrypted) attachment reference rendered via AttachmentView. */
  attachmentRef?: AttachmentRef;
  reactions?: Reaction[];
  /** Number of replies if this message anchors a thread. */
  threadCount?: number;
  /** Whether this message @-mentions the current user. */
  mention?: boolean;
  /** Whether this message arrived since the viewer last read the room. Combined
   *  with {@link mention} it escalates the highlight (a wider, stronger bar). */
  unread?: boolean;
  /** Whether the author has edited this message's text (renders an "(edited)" mark). */
  edited?: boolean;
  /** Whether the author has deleted this message (renders a "deleted" tombstone). */
  deleted?: boolean;
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
