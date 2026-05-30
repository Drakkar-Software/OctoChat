/**
 * Send-routing for a room/thread composer: try the live send when online, and
 * divert to the offline {@link ./outbox} when the device is offline OR the send
 * throws (the stream path rejects on a failed `append`). Returns the pending bubbles
 * + a retry for this surface so the screen can hand them to its conversation view.
 *
 * Attempt-driven, per the outbox design: the `online` flag is a hint/optimization,
 * not a hard gate — even a wrong "online" lands a failed send in the queue. The
 * generated `id` is threaded into both the live send and the queued entry so a
 * flushed message dedups against its own pending bubble (no duplicate).
 *
 * Text only: a message WITH an attachment is left to the screen (attachments need a
 * connection — their bytes aren't queued); see `online` in the return value.
 */
import { useCallback } from 'react';

import { useOnline } from './connectivity';
import { randomId } from './ids';
import { useOutbox } from './outbox';
import { useSession } from './session-context';
import { spaceIdFromRoomId } from './starfish/paths';
import type { RoomKind } from './types';

/** A room/thread `send` — matches both `useRoom` and `useStreamRoom` (the optional
 *  `id` lets a queued message reuse its pending-bubble id). `useRoom.send` returns a
 *  boolean (`false` ⇒ not applied, e.g. no open store offline); `useStreamRoom.send`
 *  returns the append promise (rejects when offline) — both signal "divert to queue". */
type SendFn = (text: string, parentId?: string, attachment?: undefined, id?: string) => void | boolean | Promise<void>;

export function useRoomSend(opts: { roomId: string; kind: RoomKind; parentId?: string; send: SendFn }) {
  const { roomId, kind, parentId, send } = opts;
  const { session } = useSession();
  const online = useOnline();
  const { pending, enqueue, retry } = useOutbox(roomId, parentId);

  /** Send a text message — live when possible, queued otherwise. */
  const sendText = useCallback(
    async (text: string): Promise<void> => {
      const t = text.trim();
      if (!t || !session) return;
      const id = randomId();
      if (online) {
        // The send RESULT — not the `online` flag alone — decides whether to queue:
        // `useRoom.send` returns `false` when its store isn't open (offline, the SDK
        // store can't build without the encryptor), and `useStreamRoom.send` rejects
        // when the append can't reach the server. Either ⇒ divert to the outbox so the
        // message is never silently dropped even when `online` is wrongly true (the
        // native SSE proxy can be stuck optimistic-true). `Promise.resolve` flattens the
        // sync boolean and the append promise into one shape.
        const applied = await Promise.resolve(send(t, parentId, undefined, id)).catch(() => false);
        if (applied !== false) return;
      }
      enqueue({
        id,
        roomId,
        spaceId: spaceIdFromRoomId(roomId),
        kind,
        authorId: session.userId,
        text: t,
        parentId,
        ts: Date.now(),
        status: 'queued',
        attempts: 0,
      });
    },
    [session, online, send, roomId, kind, parentId, enqueue],
  );

  return { online, pending, retry, sendText };
}
