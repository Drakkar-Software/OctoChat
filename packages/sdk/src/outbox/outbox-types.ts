/**
 * The shape of an unsent message held in the offline outbox. Extracted so the
 * headless send path ({@link ./outbox-send}) and the render-time merge
 * ({@link ./message-view}) can share it without depending on the app's outbox
 * store (which is a UI-framework concern and stays in the app).
 */
import type { RoomKind } from '../domain/types';

export type OutboxStatus = 'queued' | 'sending' | 'failed';

/** One unsent message held in the outbox. `text`-only — attachments require a
 *  connection (their bytes are not persisted here). */
export interface OutboxMessage {
  id: string;
  roomId: string;
  spaceId: string;
  kind: RoomKind;
  authorId: string;
  text: string;
  /** Set when this is a thread reply — keys the entry to (roomId, parentId). */
  parentId?: string;
  ts: number;
  status: OutboxStatus;
  /** Failed send attempts so far (for backoff / display). */
  attempts: number;
}
