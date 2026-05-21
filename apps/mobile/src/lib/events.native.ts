/**
 * Live room-change SSE subscription — native (streaming `fetch`). Best-effort,
 * secondary to web; if it proves flaky in real device testing, swap in
 * `react-native-sse`. Contract + parsing live in `events.shared.ts`.
 */
import { SYNC_BASE } from './starfish/config';
import { parseRoomChange, type RoomChange } from './events.shared';

export type { RoomChange } from './events.shared';

const RECONNECT_MS = 3000;

/** Subscribe to room-change events from `${SYNC_BASE}/events`. Returns unsubscribe. */
export function subscribeRoomChanges(onChange: (e: RoomChange) => void): () => void {
  const controller = new AbortController();
  let closed = false;

  const emit = (frame: string) => {
    for (const line of frame.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const change = parseRoomChange(line.slice(5).trim());
      if (change) onChange(change);
    }
  };

  void (async () => {
    while (!closed) {
      try {
        const res = await fetch(`${SYNC_BASE}/events`, {
          headers: { Accept: 'text/event-stream' },
          signal: controller.signal,
        });
        const body = res.body as ReadableStream<Uint8Array> | null;
        if (!body) throw new Error('no stream body');
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            emit(buf.slice(0, idx));
            buf = buf.slice(idx + 2);
          }
        }
      } catch {
        if (closed) return;
      }
      if (!closed) await new Promise((r) => setTimeout(r, RECONNECT_MS));
    }
  })();

  return () => {
    closed = true;
    controller.abort();
  };
}
