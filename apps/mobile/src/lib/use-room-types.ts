/**
 * The contract the room-data hook returns, so a screen consumes any room behind ONE type.
 * Every room is an append-only log now, so the single `useRoom` implements this.
 */
import type { AttachmentRef } from '@drakkar.software/octochat-sdk';
import type { ConversationStore } from './use-conversation-data';

/** A send call. The return is load-bearing for outbox routing: `send` resolves to a
 *  success boolean (`Promise<boolean>`) — `false` ⇒ the append did NOT commit (offline,
 *  or the room isn't open yet) and `use-room-send` diverts the message to the offline
 *  outbox. The `boolean`/`void` arms keep the union back-compatible for any non-append
 *  caller; `await`ing the result is a no-op on those arms. */
export type RoomSend = (
  text: string,
  parentId?: string,
  attachment?: AttachmentRef,
  id?: string,
) => boolean | void | Promise<void> | Promise<boolean>;

export interface RoomHook {
  /** The store the conversation view reads (`useStarfishData`). Null in the brief
   *  pre-open window when an offline open had no cache to fall back to. */
  store: ConversationStore | null;
  opening: boolean;
  /** A hard, user-facing access error (not connectivity). */
  openError: string | null;
  /** Showing cached/stale data (offline, or awaiting a fresh pull). */
  offline: boolean;
  reload: () => void;
  /** Repeated sync failures, surfaced as a banner; null when healthy. */
  syncError: string | null;
  send: RoomSend;
  toggleReaction: (msgId: string, emoji: string) => void;
  editMessage: (msgId: string, text: string) => void;
  deleteMessage: (msgId: string) => void;
  pinMessage: (msgId: string) => void;
  unpinMessage: (msgId: string) => void;
  uploadAttachment: (bytes: Uint8Array, name: string, mime: string) => Promise<AttachmentRef | null>;
  loadAttachment: (ref: AttachmentRef) => Promise<Uint8Array | null>;
  canWrite: boolean;
}
