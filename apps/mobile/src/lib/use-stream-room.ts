import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppendLogCursor } from '@drakkar.software/starfish-client';
import type { AppendElement, Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import { makeClient } from './starfish/client';
import { getSpaceEncryptor } from './starfish/space-encryptor';
import { getMemberCap } from './starfish/member-caps';
import { isPublicSpaceId, publicSpaceAuth } from './starfish/pubspace';
import { kvGet, kvSet } from './starfish/kv';
import { registerPull, onSseStatus } from './room-events-bus';
import {
  pubstreamRoomPull,
  pubstreamRoomPush,
  streamRoomPull,
  streamRoomPush,
  spaceIdFromRoomId,
} from './starfish/paths';
import type { AttachmentRef } from './starfish/attachments';
import { useRoomsRegistryActions } from './rooms-registry-context';
import { useSession } from './session-context';
import { randomId } from './ids';
import { makeEmptyConversationStore, type ConversationStore } from './use-conversation-data';
import { useRoomOpenState } from './use-room-open';
import type { StoredMsg } from './message-view';
import type { MessageEditEvent, PinEvent, ReactionEvent } from './types';

/**
 * STREAM rooms — append-only rooms. Unlike {@link useRoom} (a merge-doc room synced
 * with pull→merge→push), a stream room is an append-only log: every post is a single
 * `client.append` (no pull/merge/hash/conflict), which is what lets bots/integrations
 * write without the sync protocol. Reads pull the `{ts,data}` envelopes of the log.
 *
 * Encryption follows the SPACE: a private (E2EE) space's stream is the `streamchat`
 * collection (each element sealed with the space keyring encryptor); a public space's
 * stream is the plaintext `pubstream` collection. Both render through the SAME chat UI
 * by feeding a synthetic store (data = {messages,reactions,edits}) to `RoomConversation`
 * — `useStarfishData` only ever reads `store.data`, so a plain zustand store suffices.
 *
 * Returns the SAME shape as {@link useRoom} so a room screen can use either by `kind`.
 * `enabled` lets the screen call this AND `useRoom` unconditionally (React hook rules)
 * and pick one — when false this hook does no network and holds no store.
 */
/** One append-log element: a typed envelope so a single log carries messages,
 *  reactions and edits. `t` discriminates; `e` is the payload (a StoredMsg /
 *  ReactionEvent / MessageEditEvent). Sealed as a whole for private streams. */
type StreamEnvelope =
  | { t: 'msg'; e: StoredMsg }
  | { t: 'reaction'; e: ReactionEvent }
  | { t: 'edit'; e: MessageEditEvent }
  | { t: 'pin'; e: PinEvent };

interface StreamData {
  messages: StoredMsg[];
  reactions: ReactionEvent[];
  edits: MessageEditEvent[];
  pins: PinEvent[];
}

/** Append `incoming` after `existing`, dropping any element whose `id` is already
 *  present. Preserves order (existing first, then the new tail) so the message list
 *  stays in append (ts-ascending) order, and returns `existing` unchanged when nothing
 *  new is added so an idle delta pull triggers no re-render. This dedup is the guard for
 *  a focus+SSE double-pull racing on the same checkpoint — no in-flight lock needed. */
function concatDedupById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((x) => x.id));
  const added: T[] = [];
  for (const x of incoming) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    added.push(x);
  }
  return added.length === 0 ? existing : [...existing, ...added];
}

/** Cross-restart persistence key for a room's append log. Versioned so a future
 *  envelope/shape change can bump `v1` rather than mis-read stale blobs. NOT
 *  user-scoped: the persisted blob is `cursor.getItems()` — the CIPHERTEXT envelopes
 *  for a private room (E2EE-safe at rest, decryptable only by a keyring holder) and
 *  already-public plaintext for a public room — so the roomId alone namespaces it. */
const streamLogKey = (roomId: string) => `octochat.streamlog.v1.${roomId}`;

/** Tolerant load of a persisted append log — bad/absent/wrong-shaped JSON yields `[]`
 *  (a corrupt blob must never brick the room; the next `pull` just refetches the log).
 *  These envelopes warm-start the cursor as `initialItems` so history paints instantly
 *  on open before any network round-trip. */
async function loadStreamLog(roomId: string): Promise<AppendElement[]> {
  const raw = await kvGet(streamLogKey(roomId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AppendElement[]) : [];
  } catch {
    return [];
  }
}

/** Fan a batch of DECRYPTED append elements into the three typed arrays the chat store
 *  holds. Each element's `data` is a {@link StreamEnvelope} (the cursor already decrypted
 *  it and applied the skip policy, so no per-element try/catch here); `t` discriminates
 *  msg/reaction/edit. The server-assigned `ts` is the authoritative order/time, so stamp
 *  it onto any payload that didn't carry its own. Shared by the warm-start hydrate (full
 *  persisted log) and the delta merge (just the new `pull` batch). */
function fanOut(items: AppendElement[]): StreamData {
  const messages: StoredMsg[] = [];
  const reactions: ReactionEvent[] = [];
  const edits: MessageEditEvent[] = [];
  const pins: PinEvent[] = [];
  for (const item of items) {
    const env = item.data as unknown as StreamEnvelope;
    if (!env) continue;
    if (env.t === 'msg') messages.push({ ...env.e, ts: env.e.ts || item.ts });
    else if (env.t === 'reaction') reactions.push({ ...env.e, ts: env.e.ts || item.ts });
    else if (env.t === 'edit') edits.push({ ...env.e, ts: env.e.ts || item.ts });
    else if (env.t === 'pin') pins.push({ ...env.e, ts: env.e.ts || item.ts });
  }
  return { messages, reactions, edits, pins };
}


export function useStreamRoom(roomId: string, opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true;
  const { session } = useSession();
  const { ensure: ensureRegistry } = useRoomsRegistryActions();
  const spaceId = spaceIdFromRoomId(roomId);
  const isPublic = isPublicSpaceId(spaceId);
  const [encryptor, setEncryptor] = useState<Encryptor | null>(null);
  const [client, setClient] = useState<StarfishClient | null>(null);
  // Shared open-state machine (offline-classification + reconnect re-open) — see
  // {@link useRoomOpenState}. The synthetic store still renders offline (warm history +
  // pending bubbles), so an unreachable open degrades to an offline shell, not an error.
  const { opening, openError, offline, reloadNonce, reload, beginOpen, openReached, finishOpening, failOpen } =
    useRoomOpenState();

  // The synthetic store lives for this room's lifetime, keyed by roomId so a room switch
  // (the screen stays mounted) starts fresh rather than flashing the previous room's log.
  // The incremental checkpoint no longer lives here — it's owned by the `AppendLogCursor`
  // (see `cursorRef`), which also persists the log across restarts so re-opening a room
  // paints history instantly instead of re-fetching the whole log from scratch.
  const roomStateRef = useRef<{ id: string; store: ConversationStore } | null>(null);
  if (!roomStateRef.current || roomStateRef.current.id !== roomId) {
    roomStateRef.current = { id: roomId, store: makeEmptyConversationStore() };
  }
  const roomState = enabled ? roomStateRef.current : null;
  const store = roomState?.store ?? null;

  // The per-room append-log cursor. It owns the checkpoint, the accumulated ciphertext
  // envelopes (for persistence) and the per-element skip policy (`onElementError:'skip'`),
  // replacing the hand-rolled `since`/decrypt-try/catch/maxTs loop. Built async once
  // `client` + (private) `encryptor` + the route resolve, seeded with the persisted log;
  // recreated on room switch — same lifetime as the store above. Held in a ref so `pull`
  // reads the latest without re-subscribing every callback.
  const cursorRef = useRef<{ id: string; cursor: AppendLogCursor } | null>(null);

  // Open: resolve the sync client (+ encryptor for a private space). Mirrors useRoom's
  // open branches — public spaces authorize with the invite/account cap and carry no
  // encryptor; private spaces open the space keyring encryptor (cached per space).
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset open state before reopening on room/session change
    setEncryptor(null);
    setClient(null);
    beginOpen();
    if (!enabled || !session) return;
    (async () => {
      try {
        if (isPublic) {
          const auth = publicSpaceAuth(session, spaceId);
          if (!cancelled) {
            setEncryptor(null);
            setClient(makeClient(auth.cap, auth.signingKey));
            finishOpening(); // public open did no network call — proves no reachability
          }
          return;
        }
        const reg = getMemberCap(spaceId) ? null : await ensureRegistry(spaceId);
        const { encryptor: enc, client: roomClient } = await getSpaceEncryptor(spaceId, session, reg);
        if (!cancelled) {
          setEncryptor(enc);
          setClient(roomClient);
          openReached();
          finishOpening();
        }
      } catch (e) {
        if (!cancelled) failOpen(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, session, roomId, spaceId, isPublic, ensureRegistry, reloadNonce, beginOpen, openReached, finishOpening, failOpen]);

  // Auth + path for this stream room (owner/joiner cap on public; member/space cap on
  // private). `signingKey` is the request-signing key the cap is bound to.
  const route = useMemo(() => {
    if (!session) return null;
    if (isPublic) {
      const auth = publicSpaceAuth(session, spaceId);
      return {
        pull: pubstreamRoomPull(auth.ownerId, spaceId, roomId),
        push: pubstreamRoomPush(auth.ownerId, spaceId, roomId),
        canWrite: auth.write,
      };
    }
    return { pull: streamRoomPull(roomId), push: streamRoomPush(roomId), canWrite: true };
  }, [session, isPublic, spaceId, roomId]);

  // Merge a DECRYPTED batch into the store's {messages,reactions,edits}, appending onto
  // what the store already holds and de-duping by id. Skip the write entirely when nothing
  // new survives the dedup, so an idle poll / a focus+SSE double-pull never churns a
  // re-render (the cursor serializes pulls and dedups by `ts`, but `concatDedupById` is
  // still the cheap belt-and-braces guard against re-rendering an unchanged list).
  const mergeIntoStore = useCallback((store: ConversationStore, batch: StreamData) => {
    if (!batch.messages.length && !batch.reactions.length && !batch.edits.length && !batch.pins.length) return;
    const cur = (store.getState() as unknown as { data: StreamData }).data;
    const messages = concatDedupById(cur.messages, batch.messages);
    const reactions = concatDedupById(cur.reactions, batch.reactions);
    const edits = concatDedupById(cur.edits, batch.edits);
    const pins = concatDedupById(cur.pins ?? [], batch.pins);
    if (messages === cur.messages && reactions === cur.reactions && edits === cur.edits && pins === (cur.pins ?? [])) return;
    store.setState({ data: { messages, reactions, edits, pins } } as never);
  }, []);

  // Pull the append log and fan the NEW batch into the store. The cursor owns the
  // checkpoint and the incremental window: `pull()` fetches only elements newer than the
  // last it holds, decrypts them (private) / passes them through (public), drops any that
  // fail under `onElementError:'skip'`, and returns ONLY that new batch — so we never
  // re-fetch + rebuild the whole room on every focus / SSE push / poll tick. The seeded
  // `initialItems` (warm-started history) are NOT returned by `pull()`; they're painted
  // once on open via `getDecryptedItems()` in the build effect below.
  //
  // After a non-empty pull, persist the cursor's CIPHERTEXT envelopes back to storage so
  // the next open paints this history instantly; an idle (empty) pull writes nothing.
  const [syncError, setSyncError] = useState<string | null>(null);
  const pull = useCallback(async () => {
    const cur = cursorRef.current;
    if (!cur || cur.id !== roomId || !roomState) return;
    try {
      const batch = await cur.cursor.pull();
      if (batch.length) {
        mergeIntoStore(roomState.store, fanOut(batch));
        void kvSet(streamLogKey(roomId), JSON.stringify(cur.cursor.getItems()));
      }
      setSyncError((prev) => (prev === null ? prev : null));
    } catch {
      setSyncError('Reconnecting… messages may be out of date.');
    }
  }, [roomId, roomState, mergeIntoStore]);

  // Build the per-room cursor once `client` + (private) `encryptor` + the route resolve.
  // Async, because the warm-start seed is loaded from KV: load the persisted CIPHERTEXT
  // envelopes → construct the cursor with them as `initialItems` (so its checkpoint starts
  // past them and the first `pull` fetches only the delta) → paint that persisted history
  // immediately via `getDecryptedItems()` so the room shows without a network round-trip →
  // then `pull()` to fetch anything newer. Recreated on room/client/encryptor change; a
  // `cancelled` flag drops a stale build that resolves after a room switch. The cursor's
  // `encryptor` decrypts on pull for a private room and is omitted for a public (plaintext)
  // one — replacing the hand-rolled per-element decrypt/try-catch with the cursor's policy.
  useEffect(() => {
    if (!enabled || !client || !route || !roomState) return;
    let cancelled = false;
    (async () => {
      const initialItems = await loadStreamLog(roomId);
      if (cancelled) return;
      const cursor = new AppendLogCursor({
        client,
        pullPath: route.pull,
        appendField: 'items',
        ...(encryptor ? { encryptor } : {}),
        onElementError: 'skip',
        initialItems,
      });
      cursorRef.current = { id: roomId, cursor };
      if (initialItems.length) {
        const history = await cursor.getDecryptedItems();
        if (cancelled) return;
        roomState.store.setState({ data: fanOut(history) } as never);
      }
      if (cancelled) return;
      void pull();
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, client, encryptor, route, roomId, roomState, pull]);

  // Append one envelope: seal it for a private stream, send it plain for a public one.
  // No client-supplied ts → the server assigns a strictly-monotonic one (no 409 on
  // concurrent appends). This is the whole point of a stream room: append, no merge.
  const append = useCallback(
    async (env: StreamEnvelope) => {
      if (!client || !route) return;
      const body = encryptor
        ? ((await (encryptor as unknown as { encrypt: (d: Record<string, unknown>) => Promise<Record<string, unknown>> }).encrypt(
            env as unknown as Record<string, unknown>,
          )) as Record<string, unknown>)
        : (env as unknown as Record<string, unknown>);
      await client.append(route.push, body);
      void pull(); // reflect our own append immediately
    },
    [client, route, encryptor, pull],
  );

  // Live updates: pull on focus + on the shared SSE bus, with a poll fallback only
  // while the SSE stream is down. Public streams now ride /events too (the proxy
  // open-gates `psp-` spaces), so they no longer poll on every tick.
  // Unlike useRoom, we pull on EVERY focus including the first: useRoom skips its first
  // focus only because the SDK's useSyncInit store self-pulls on creation, but this
  // synthetic store's `pull` is a no-op — so without a first-focus pull, opening a
  // stream room would show nothing until an SSE push or a re-focus.
  const [sseUp, setSseUp] = useState(false);
  useEffect(() => onSseStatus(setSseUp), []);
  useFocusEffect(
    useCallback(() => {
      if (!store || !client) {
        setSyncError(null);
        return;
      }
      void pull();
      return registerPull(roomId, () => void pull());
    }, [store, client, roomId, pull]),
  );
  useEffect(() => {
    if (!store || !client || sseUp) return;
    const id = setInterval(() => void pull(), 4000);
    return () => clearInterval(id);
  }, [store, client, sseUp, pull]);

  // Signature matches useRoom's `send` so a screen can consume either hook by `kind`
  // (the union call-site stays type-clean). `attachment` is ignored — stream rooms
  // don't support attachments in Phase 1 (the bot-push contract is a plain JSON append).
  const send = useCallback(
    (text: string, parentId?: string, _attachment?: AttachmentRef, id?: string) => {
      const t = text.trim();
      if (!session || !t) return;
      // `id` lets a queued (offline) message reuse its pending-bubble id so it dedups
      // on sync instead of double-rendering (see outbox.ts); live sends mint a fresh one.
      const msg: StoredMsg = { id: id ?? randomId(), authorId: session.userId, ts: Date.now(), text: t };
      if (parentId) msg.parentId = parentId;
      // Return the append promise (not `void`) so the screen can await + catch a
      // failed (offline) send and divert the message to the outbox. useRoom.send is
      // sync/void; `await send(…)` works for both since awaiting undefined is a no-op.
      return append({ t: 'msg', e: msg });
    },
    [session, append],
  );

  const toggleReaction = useCallback(
    (msgId: string, emoji: string) => {
      if (!session) return;
      const me = session.userId;
      const cur = (store?.getState() as { data: StreamData } | undefined)?.data.reactions ?? [];
      const net = cur
        .filter((e) => e.msgId === msgId && e.emoji === emoji && e.userId === me)
        .reduce((n, e) => n + (e.kind === 'add' ? 1 : -1), 0);
      void append({
        t: 'reaction',
        e: { id: randomId(), msgId, emoji, userId: me, kind: net > 0 ? 'remove' : 'add', ts: Date.now() },
      });
    },
    [session, store, append],
  );

  const editMessage = useCallback(
    (msgId: string, text: string) => {
      const t = text.trim();
      if (!session || !t) return;
      void append({ t: 'edit', e: { id: randomId(), msgId, userId: session.userId, kind: 'edit', text: t, ts: Date.now() } });
    },
    [session, append],
  );

  const deleteMessage = useCallback(
    (msgId: string) => {
      if (!session) return;
      void append({ t: 'edit', e: { id: randomId(), msgId, userId: session.userId, kind: 'delete', ts: Date.now() } });
    },
    [session, append],
  );

  // Pin/unpin append a `pin` envelope (mirrors edit/delete); folded by `resolvePinned`
  // with the space owner as the guard. UI only fires these for the owner.
  const pinMessage = useCallback(
    (msgId: string) => {
      if (!session) return;
      void append({ t: 'pin', e: { id: randomId(), msgId, userId: session.userId, kind: 'pin', ts: Date.now() } });
    },
    [session, append],
  );
  const unpinMessage = useCallback(
    (msgId: string) => {
      if (!session) return;
      void append({ t: 'pin', e: { id: randomId(), msgId, userId: session.userId, kind: 'unpin', ts: Date.now() } });
    },
    [session, append],
  );

  // Attachments are not supported in stream rooms (Phase 1): the bot-push contract is a
  // plain JSON append, and public streams have no encryptor to seal a blob. Kept in the
  // returned shape (no-ops) so a room screen can consume useRoom or useStreamRoom alike.
  const uploadAttachment = useCallback(async (_bytes: Uint8Array, _name: string, _mime: string): Promise<AttachmentRef | null> => null, []);
  const loadAttachment = useCallback(async (_ref: AttachmentRef): Promise<Uint8Array | null> => null, []);

  return {
    store,
    opening: enabled ? opening : false,
    openError,
    offline,
    reload,
    syncError,
    send,
    toggleReaction,
    editMessage,
    deleteMessage,
    pinMessage,
    unpinMessage,
    uploadAttachment,
    loadAttachment,
    canWrite: route?.canWrite ?? false,
  };
}
