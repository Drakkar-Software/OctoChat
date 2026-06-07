/**
 * The shared contract the two room-data hooks return, so a screen can consume either
 * by the room's `kind` behind ONE type. `useRoom` (merge-doc channels + DMs) and
 * `useStreamRoom` (append-only public-stream + automated rooms) both implement this.
 */
import type { AttachmentRef } from '@drakkar.software/octochat-sdk';
import type { ConversationStore } from './use-conversation-data';

/** A send call. The return DIVERGES by room kind and is load-bearing for outbox
 *  routing: `useRoom` returns `boolean` (was it applied to the live store? — `false`
 *  diverts to the offline outbox), `useStreamRoom` returns the append `Promise` (reject
 *  → outbox). The caller `await`s the result, which works for both (awaiting a boolean
 *  or `undefined` is a no-op), so the contract stays a union rather than being unified. */
export type RoomSend = (
  text: string,
  parentId?: string,
  attachment?: AttachmentRef,
  id?: string,
) => boolean | void | Promise<void>;

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
