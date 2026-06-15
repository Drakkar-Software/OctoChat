import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AppendLogCursor } from '@drakkar.software/octochat-sdk';
import type { NodeAccess } from '@drakkar.software/octochat-sdk';
import { getSpaceAccessEntry, getNodeAccessEntry } from '@drakkar.software/octochat-sdk';
import {
  concatDedupById,
  fanOut,
  loadStreamLog,
  streamLogKey,
  type StreamData,
  type StreamEnvelope,
} from '@drakkar.software/octochat-sdk';
import { kvSet } from '@drakkar.software/octochat-sdk';
import { reportReachability } from './connectivity';
import {
  streamRoomPull,
  streamRoomPush,
  streamPubRoomPull,
  streamPubRoomPush,
  streamInvRoomPull,
  streamInvRoomPush,
  spaceIdFromRoomId,
} from '@drakkar.software/octochat-sdk';
import {
  loadAttachment as loadAttachmentDoc,
  uploadAttachment as uploadAttachmentDoc,
  type AttachmentRef,
  type ByteSealer,
} from '@drakkar.software/octochat-sdk';
import { messageDeleteEvent, messageEditEvent, pinToggleEvent, reactionToggleEvent } from '@drakkar.software/octochat-sdk';
import { useSession } from './session-context';
import { randomId } from '@drakkar.software/octochat-sdk';
import { makeEmptyConversationStore, type ConversationStore } from './use-conversation-data';
import { useRoomOpen } from './use-room-open-flow';
import { useRoomLiveSync } from './use-room-live-sync';
import type { RoomHook } from './use-room-types';
import type { StoredMsg } from '@drakkar.software/octochat-sdk';

/**
 * THE room hook — every room is an APPEND-ONLY log. Every post is a single
 * `client.append` (no pull/merge/hash/conflict), which is what also lets bots/integrations
 * write without the sync protocol. Reads pull the `{ts,data}` envelopes of the log.
 *
 * Encryption follows the room node: an enc:true room's log is the `streamchat`
 * collection (each element sealed with the space keyring encryptor); a public room uses
 * `streampub`; an invite-plaintext room uses `streaminv`. All render through the chat UI by feeding a
 * synthetic store (data = {messages,reactions,edits,pins}) to `RoomConversation` —
 * `useStarfishData` only ever reads `store.data`, so a plain zustand store suffices.
 *
 * Returns a {@link RoomHook}. The crypto/auth open is shared via {@link useRoomOpen}; the
 * focus/poll/SSE choreography via {@link useRoomLiveSync}; the append-only event shapes
 * via the builders in {@link ./reactions}. `enabled` lets a screen call this hook
 * unconditionally (React hook rules) and gate it — when false it does no network and
 * holds no store. Attachments (private spaces only) seal a blob to the separate
 * `attachments` collection, exactly as the old merge-doc room did.
 */
export function useRoom(roomId: string, opts: { enabled?: boolean; access?: NodeAccess; enc?: boolean; owner?: string | null } = {}): RoomHook {
  const enabled = opts.enabled ?? true;
  // Per-node access flags from the object index (passed by the room screen once the
  // registry resolves). When access is not yet known (registry still loading), default
  // enc to false — avoids a SpaceAccessError for public/invite rooms before the registry
  // settles. Once the caller passes a known access value, enc defaults to true.
  const access = opts.access;
  const enc = opts.enc ?? (opts.access !== undefined ? true : false);
  const { session } = useSession();
  const spaceId = spaceIdFromRoomId(roomId);

  // Shared crypto/auth open (+ opening/error/offline flags & reconnect). An append-only
  // room has no doc to seed (it pulls as [] until its first append). The synthetic store
  // still renders offline (warm history + pending bubbles); reachability is reported from
  // a fresh cursor `pull()` below, not from the open.
  const { encryptor, client, opening, openError, offline, reload } = useRoomOpen({
    roomId,
    spaceId,
    enc,
    enabled,
    owner: opts.owner,
  });

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

  // Per-node path routing: public rooms → streampub (anonymous read / member write);
  // invite-plaintext rooms → streaminv (cap-gated); everything else → streamchat.
  const route = useMemo(() => {
    if (!session) return null;
    if (access === 'public') {
      return { pull: streamPubRoomPull(roomId), push: streamPubRoomPush(roomId), canWrite: true };
    }
    if (access === 'invite' && !enc) {
      // Derive write permission from the stored access entry. Prefer the per-node entry
      // (set when invited to a specific node) over the space-wide entry, matching the
      // SDK's own nodeEntry ?? spaceEntry precedence in getNodeAccess / buildNodeAccess.
      // A link-kind entry carries an explicit `write` flag; a member-kind entry always has
      // write access.
      const entry = getNodeAccessEntry(spaceId, roomId) ?? getSpaceAccessEntry(spaceId);
      const canWrite = !entry || entry.kind === 'member' || (entry.kind === 'link' && entry.write);
      return { pull: streamInvRoomPull(roomId), push: streamInvRoomPush(roomId), canWrite };
    }
    return { pull: streamRoomPull(roomId), push: streamRoomPush(roomId), canWrite: true };
  }, [session, access, enc, roomId, spaceId]);

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

  // Drop one message id from the store — the rollback half of the optimistic echo: when
  // an optimistically-painted send turns out not to have committed, remove its bubble so
  // only the outbox's queued bubble remains (no duplicate). A no-op if the id isn't there.
  const removeMessageFromStore = useCallback((store: ConversationStore, id: string) => {
    const cur = (store.getState() as unknown as { data: StreamData }).data;
    const messages = cur.messages.filter((m) => m.id !== id);
    if (messages.length === cur.messages.length) return; // wasn't present
    store.setState({ data: { ...cur, messages } } as never);
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
        void kvSet(streamLogKey(session!.userId, roomId), JSON.stringify(cur.cursor.getItems()));
      }
      // A successful cursor pull is the real reachability signal (append-log pulls
      // aren't served from the offline cache — they own their warm-start persistence).
      reportReachability(true);
      setSyncError((prev) => (prev === null ? prev : null));
    } catch {
      reportReachability(false);
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
      const initialItems = await loadStreamLog(session!.userId, roomId);
      if (cancelled) return;
      const cursor = new AppendLogCursor({
        client,
        pullPath: route.pull,
        appendField: 'items',
        // `persistEncrypted` keeps `getItems()` (what we kvSet below) as the CIPHERTEXT
        // envelopes for a private room — E2EE-safe at rest. WITHOUT it the cursor stores
        // DECRYPTED elements and we'd write plaintext message bodies to KV. A public room
        // has no encryptor (the flag is a no-op there — plaintext is its own stored form).
        ...(encryptor ? { encryptor, persistEncrypted: true } : {}),
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

  // Append one envelope: seal it for a private room, send it plain for a public one.
  // No client-supplied ts → the server assigns a strictly-monotonic one (no 409 on
  // concurrent appends). This is the whole point of an append-only room: append, no merge.
  //
  // Returns whether the append COMMITTED to the server: `false` when the room isn't open
  // yet (the Composer renders from `canWrite`/`route` BEFORE `client` resolves, so a send
  // can land in that window) OR when the network append throws. Caught internally so a
  // failure is a `false` return, never a rejection — `send` reports it to the outbox and
  // the best-effort reaction/edit/pin callers just ignore it (no unhandled rejection).
  const append = useCallback(
    async (env: StreamEnvelope): Promise<boolean> => {
      if (!client || !route) return false;
      try {
        const body = encryptor
          ? ((await (encryptor as unknown as { encrypt: (d: Record<string, unknown>) => Promise<Record<string, unknown>> }).encrypt(
              env as unknown as Record<string, unknown>,
            )) as Record<string, unknown>)
          : (env as unknown as Record<string, unknown>);
        await client.append(route.push, body);
      } catch {
        return false; // couldn't reach the server → caller diverts to the outbox
      }
      void pull(); // reflect our own append immediately
      return true;
    },
    [client, route, encryptor, pull],
  );

  // Live updates: pull on focus + on the shared SSE bus, poll only while SSE is down
  // (see useRoomLiveSync). `ready` requires the client (not just the store, which is the
  // always-present synthetic one). Unlike useRoom we pull on EVERY focus including the
  // first (skipFirstFocus omitted): the SDK store self-pulls on creation, but this
  // synthetic store's `pull` is a cursor fetch — without a first-focus pull, opening a
  // the room would show nothing until an SSE push or a re-focus.
  useRoomLiveSync({
    roomId,
    ready: !!store && !!client,
    pull: () => void pull(),
    onIdle: () => setSyncError(null),
  });

  // Post a text/attachment message. `attachment` rides the same envelope (private rooms
  // only — see uploadAttachment). The return is the append's success boolean
  // (Promise<boolean>): `false` ⇒ not committed (offline / room not open yet), which
  // `use-room-send` diverts to the outbox so the message is never silently dropped.
  const send = useCallback(
    (text: string, parentId?: string, attachment?: AttachmentRef, id?: string) => {
      const t = text.trim();
      if (!session || (!t && !attachment)) return;
      // `id` lets a queued (offline) message reuse its pending-bubble id so it dedups
      // on sync instead of double-rendering (see outbox.ts); live sends mint a fresh one.
      const msg: StoredMsg = { id: id ?? randomId(), authorId: session.userId, ts: Date.now() };
      if (t) msg.text = t;
      if (parentId) msg.parentId = parentId;
      if (attachment) msg.attachment = attachment;
      // Optimistic echo: paint the bubble immediately so it shows the instant the user
      // sends — not after the append + follow-up pull round-trip. The append's own pull
      // dedups the server copy by id (same id, same client `ts` → no reorder, no dup); if
      // the append did NOT commit we roll the bubble back so only the outbox's queued
      // bubble remains. (`use-room-send` skips calling `send` when known-offline, so the
      // optimistic paint is reserved for sends we actually expect to land.)
      if (store) mergeIntoStore(store, { messages: [msg], reactions: [], edits: [], pins: [] });
      return append({ t: 'msg', e: msg }).then((ok) => {
        if (!ok && store) removeMessageFromStore(store, msg.id);
        return ok;
      });
    },
    [session, store, append, mergeIntoStore, removeMessageFromStore],
  );

  // Reactions/edits/deletes/pins append a typed envelope. The event shapes (incl. the
  // reaction net-toggle) come from shared builders in `./reactions`, so the merge-doc and
  // append-log paths can't drift; only the WRITE differs — here it's an `append`.
  const toggleReaction = useCallback(
    (msgId: string, emoji: string) => {
      if (!session) return;
      const cur = (store?.getState() as { data: StreamData } | undefined)?.data.reactions ?? [];
      void append({ t: 'reaction', e: reactionToggleEvent(cur, msgId, emoji, session.userId, Date.now()) });
    },
    [session, store, append],
  );

  const editMessage = useCallback(
    (msgId: string, text: string) => {
      const t = text.trim();
      if (!session || !t) return;
      void append({ t: 'edit', e: messageEditEvent(msgId, session.userId, t, Date.now()) });
    },
    [session, append],
  );

  const deleteMessage = useCallback(
    (msgId: string) => {
      if (!session) return;
      void append({ t: 'edit', e: messageDeleteEvent(msgId, session.userId, Date.now()) });
    },
    [session, append],
  );

  const pinMessage = useCallback(
    (msgId: string) => {
      if (!session) return;
      void append({ t: 'pin', e: pinToggleEvent(msgId, session.userId, 'pin', Date.now()) });
    },
    [session, append],
  );
  const unpinMessage = useCallback(
    (msgId: string) => {
      if (!session) return;
      void append({ t: 'pin', e: pinToggleEvent(msgId, session.userId, 'unpin', Date.now()) });
    },
    [session, append],
  );

  // Attachments live in the separate `attachments` collection (orthogonal to the
  // append-only message log). For encrypted (E2EE) rooms the encryptor seals the blob
  // client-side; for plaintext (public/unencrypted) rooms we pass null and the bytes
  // are stored raw — the SDK's uploadAttachment/loadAttachment handle both paths.
  // The only requirement is an open space client (`client`).
  const uploadAttachment = useCallback(
    async (bytes: Uint8Array, name: string, mime: string): Promise<AttachmentRef | null> => {
      if (!client) return null;
      return uploadAttachmentDoc(client, encryptor ? (encryptor as unknown as ByteSealer) : null, roomId, bytes, name, mime);
    },
    [client, encryptor, roomId],
  );
  const loadAttachment = useCallback(
    async (ref: AttachmentRef): Promise<Uint8Array | null> => {
      if (!client) return null;
      return loadAttachmentDoc(client, encryptor ? (encryptor as unknown as ByteSealer) : null, roomId, ref);
    },
    [client, encryptor, roomId],
  );

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
