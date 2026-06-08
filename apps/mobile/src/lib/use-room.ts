import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createUnionMerge } from '@drakkar.software/starfish-client';
import { useSyncInit } from '@drakkar.software/starfish-client/zustand';

import { SYNC_BASE, SYNC_NAMESPACE } from './octochat-config';
import { capProviderFor } from '@drakkar.software/octochat-sdk';
import { fetchWithTimeout } from '@drakkar.software/octochat-sdk';
import { reportReachability } from './connectivity';
import {
  loadAttachment as loadAttachmentDoc,
  uploadAttachment as uploadAttachmentDoc,
  type AttachmentRef,
  type ByteSealer,
} from '@drakkar.software/octochat-sdk';
import { getMemberCap } from '@drakkar.software/octochat-sdk';
import { pullCache, PULL_CACHE_MAX_AGE_MS } from '@drakkar.software/octochat-sdk';
import { isPublicSpaceId, publicSpaceAuth } from '@drakkar.software/octochat-sdk';
import { pubspaceRoomPull, pubspaceRoomPush, roomPull, roomPush, spaceIdFromRoomId } from '@drakkar.software/octochat-sdk';
import { messageDeleteEvent, messageEditEvent, pinToggleEvent, reactionToggleEvent } from '@drakkar.software/octochat-sdk';
import type { MessageEditEvent, PinEvent, ReactionEvent } from '@drakkar.software/octochat-sdk';
import { useSession } from './session-context';
import { makeEmptyConversationStore, type ConversationStore } from './use-conversation-data';
import { useRoomOpen } from './use-room-open-flow';
import { useRoomLiveSync } from './use-room-live-sync';
import type { RoomHook } from './use-room-types';
import { randomId } from '@drakkar.software/octochat-sdk';

/**
 * Opens a room and builds a synced Zustand store. Two modes by the room's space:
 *  - PRIVATE (E2EE): ensure the space keyring/encryptor + room doc exist, sync with
 *    the encryptor (sealed messages). Joiners open as keyring recipients.
 *  - PUBLIC (plaintext): NO keyring/encryptor — authorize with the invitation cap
 *    (joiner) or the account cap (owner) and sync the plaintext `pubspaces/…` doc.
 * Live updates via the shared SSE bus with a polling fallback (uniform web+native).
 *
 * The crypto/auth open is shared with {@link useStreamRoom} via {@link useRoomOpen};
 * the focus/poll/SSE choreography via {@link useRoomLiveSync}; the append-only event
 * shapes via the builders in {@link ./reactions}.
 *
 * MUST be called from a router screen: it gates its live pull on `useFocusEffect`,
 * which needs a navigator context. Both callers (room/[id], thread/[id]) are screens.
 */
export function useRoom(roomId: string, opts: { enabled?: boolean } = {}): RoomHook {
  // `enabled` lets a screen call this AND useStreamRoom unconditionally (React hook
  // rules) and pick one by the room's kind. When false this hook opens nothing.
  const enabled = opts.enabled ?? true;
  const { session } = useSession();
  const spaceId = spaceIdFromRoomId(roomId);
  const isPublic = isPublicSpaceId(spaceId);

  // Shared crypto/auth open (+ opening/error/offline flags & reconnect). Merge-doc owner
  // opens seed the room doc, hence `initializeRoom: true`. Offline-first: the encryptor
  // builds from the SDK pull cache even offline; reachability is reported below from the
  // store's first FRESH pull, not from the open.
  const { encryptor, client, opening, openError, offline, reload } = useRoomOpen({
    roomId,
    spaceId,
    isPublic,
    enabled,
    initializeRoom: true,
  });

  const config = useMemo(() => {
    if (!enabled || !session || !client) return null;
    if (isPublic) {
      // Plaintext sync: no `encryptor` (the SDK treats its absence as plaintext).
      const auth = publicSpaceAuth(session, spaceId);
      return {
        serverUrl: SYNC_BASE,
        namespace: SYNC_NAMESPACE,
        capProvider: capProviderFor(auth.cap, auth.signingKey),
        pullPath: pubspaceRoomPull(auth.ownerId, spaceId, roomId),
        pushPath: pubspaceRoomPush(auth.ownerId, spaceId, roomId),
        onConflict: createUnionMerge(),
        storeName: `pub-${session.userId}-${roomId}`,
        storage: false as const,
        fetch: fetchWithTimeout(),
        // Offline-first: cache-first paint + offline fallback for the plaintext
        // public room doc. Ciphertext-at-rest N/A (public is plaintext).
        cache: pullCache(),
        cacheMaxAgeMs: PULL_CACHE_MAX_AGE_MS,
      };
    }
    if (!encryptor) return null;
    const memberCap = getMemberCap(spaceId);
    const cap = memberCap ? JSON.parse(memberCap) : session.chatCap;
    return {
      serverUrl: SYNC_BASE,
      namespace: SYNC_NAMESPACE,
      capProvider: capProviderFor(cap, session.keys.edPriv),
      pullPath: roomPull(roomId),
      pushPath: roomPush(roomId),
      encryptor,
      onConflict: createUnionMerge(),
      storeName: `chat-${session.userId}-${roomId}`,
      storage: false as const,
      fetch: fetchWithTimeout(),
      // Offline-first: the store seeds from the cached ciphertext (decrypted in
      // memory by `encryptor`) and falls back to it offline — last-synced messages
      // show without a network round-trip. Only ciphertext is ever persisted.
      cache: pullCache(),
      cacheMaxAgeMs: PULL_CACHE_MAX_AGE_MS,
    };
  }, [enabled, session, client, encryptor, roomId, spaceId, isPublic]);

  const store = useSyncInit(config);

  // Offline-first store status. The SDK store now builds even offline (the encryptor
  // comes from the cached keyring) and paints last-synced messages from its read-through
  // cache, flagging `stale` until a FRESH server pull lands. We track two things off it:
  //  - `storeStale` → drives the offline banner (we're showing cached data).
  //  - `liveReady`  → a fresh (non-stale) pull has settled, i.e. the server is reachable
  //    AND this store holds live data. ALL mutations route through this gate so an
  //    offline `set` can't write into a store the user sees but whose push would fail
  //    (it diverts to the durable outbox instead). Reachability is reported here, not
  //    from the encryptor build (which may have used the cache).
  const [liveReady, setLiveReady] = useState(false);
  const [storeStale, setStoreStale] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset live/stale flags when the store identity changes (room switch / reopen), then track via subscribe
    setLiveReady(false);
    setStoreStale(false);
    if (!store) return;
    setStoreStale(store.getState().stale);
    let prevSyncing = store.getState().syncing;
    return store.subscribe((s) => {
      setStoreStale(s.stale);
      if (prevSyncing && !s.syncing && !s.error) {
        // A pull/flush just settled. Cache-served (stale) ⇒ offline; fresh ⇒ reachable.
        if (s.stale) reportReachability(false);
        else { setLiveReady(true); reportReachability(true); }
      }
      prevSyncing = s.syncing;
    });
  }, [store]);

  // The store to MUTATE: only once a fresh pull confirms reachability. Null offline /
  // pre-first-pull → send/reactions/etc. return false and divert to the outbox.
  const liveStore = liveReady ? store : null;

  // The store to DISPLAY. The SDK store (cached or live) whenever it exists; an empty
  // shell only in the brief pre-build window when we genuinely couldn't open offline.
  // Keyed by roomId so a room switch starts empty, not on the prior room.
  const fallbackRef = useRef<{ id: string; store: ConversationStore } | null>(null);
  if (!fallbackRef.current || fallbackRef.current.id !== roomId) {
    fallbackRef.current = { id: roomId, store: makeEmptyConversationStore() };
  }
  const displayStore = store ?? (offline ? fallbackRef.current.store : null);

  // A pull that surfaces repeated sync failures as a banner, cleared on success.
  const [syncError, setSyncError] = useState<string | null>(null);
  const pull = useCallback(() => {
    if (!store) return;
    void store.getState().pull().then(
      () => setSyncError((prev) => (prev === null ? prev : null)),
      () => setSyncError('Reconnecting… messages may be out of date.'),
    );
  }, [store]);

  // Live updates while focused: pull on focus + register on the shared SSE bus, poll
  // only while SSE is down (see useRoomLiveSync). The SDK store self-pulls on creation,
  // so skip the duplicate first-focus pull — keyed on the store object so a same-room
  // reopen also skips its own init-pull.
  useRoomLiveSync({
    roomId,
    ready: !!store,
    pull,
    skipFirstFocus: true,
    firstFocusKey: store,
    onIdle: () => setSyncError(null),
  });

  // `id` lets a queued (offline) message reuse the id its pending bubble already
  // showed, so when it finally syncs it dedups against the bubble instead of
  // double-rendering (see outbox.ts). Live sends omit it and mint a fresh id.
  // Returns whether the message was APPLIED to the LIVE store: `false` when there's no
  // live store (offline, or before the first fresh pull) so the caller (use-room-send)
  // diverts it to the offline outbox instead of writing into a store whose push would
  // fail. This makes queueing depend on the real send outcome, not on the (fallible)
  // online flag — the bug where an offline send no-op'd into a null store and vanished.
  const send = useCallback(
    (text: string, parentId?: string, attachment?: AttachmentRef, id?: string): boolean => {
      const t = text.trim();
      if (!liveStore || !session || (!t && !attachment)) return false;
      liveStore.getState().set((d: Record<string, unknown>) => {
        const msgs = (d.messages as unknown[]) ?? [];
        const msg: Record<string, unknown> = { id: id ?? randomId(), authorId: session.userId, ts: Date.now() };
        if (t) msg.text = t;
        if (parentId) msg.parentId = parentId;
        if (attachment) msg.attachment = attachment;
        return { ...d, messages: [...msgs, msg] };
      });
      return true;
    },
    [liveStore, session],
  );

  /** Seal + upload a file to the room's blob collection, returning its ref. Public
   *  rooms have no encryptor, so attachments are unavailable there (returns null). */
  const uploadAttachment = useCallback(
    async (bytes: Uint8Array, name: string, mime: string): Promise<AttachmentRef | null> => {
      if (!client || !encryptor) return null;
      return uploadAttachmentDoc(client, encryptor as unknown as ByteSealer, roomId, bytes, name, mime);
    },
    [client, encryptor, roomId],
  );

  /** Fetch + decrypt an attachment's bytes for rendering/download. */
  const loadAttachment = useCallback(
    async (ref: AttachmentRef): Promise<Uint8Array | null> => {
      if (!client || !encryptor) return null;
      return loadAttachmentDoc(client, encryptor as unknown as ByteSealer, roomId, ref);
    },
    [client, encryptor, roomId],
  );

  // Reactions/edits/deletes/pins are append-only events folded at render. The event
  // shapes (incl. the reaction net-toggle) come from shared builders in `./reactions`,
  // so the merge-doc and append-log paths can't drift; only the WRITE differs — here it's
  // a `set` into the live doc (reading the latest events inside the updater).
  const toggleReaction = useCallback(
    (msgId: string, emoji: string) => {
      if (!liveStore || !session) return;
      const me = session.userId;
      liveStore.getState().set((d: Record<string, unknown>) => {
        const events = (d.reactions as ReactionEvent[]) ?? [];
        return { ...d, reactions: [...events, reactionToggleEvent(events, msgId, emoji, me, Date.now())] };
      });
    },
    [liveStore, session],
  );

  const editMessage = useCallback(
    (msgId: string, text: string) => {
      const t = text.trim();
      if (!liveStore || !session || !t) return;
      liveStore.getState().set((d: Record<string, unknown>) => {
        const events = (d.edits as MessageEditEvent[]) ?? [];
        return { ...d, edits: [...events, messageEditEvent(msgId, session.userId, t, Date.now())] };
      });
    },
    [liveStore, session],
  );

  const deleteMessage = useCallback(
    (msgId: string) => {
      if (!liveStore || !session) return;
      liveStore.getState().set((d: Record<string, unknown>) => {
        const events = (d.edits as MessageEditEvent[]) ?? [];
        return { ...d, edits: [...events, messageDeleteEvent(msgId, session.userId, Date.now())] };
      });
    },
    [liveStore, session],
  );

  const setPinned = useCallback(
    (msgId: string, kind: 'pin' | 'unpin') => {
      if (!liveStore || !session) return;
      liveStore.getState().set((d: Record<string, unknown>) => {
        const events = (d.pins as PinEvent[]) ?? [];
        return { ...d, pins: [...events, pinToggleEvent(msgId, session.userId, kind, Date.now())] };
      });
    },
    [liveStore, session],
  );
  const pinMessage = useCallback((msgId: string) => setPinned(msgId, 'pin'), [setPinned]);
  const unpinMessage = useCallback((msgId: string) => setPinned(msgId, 'unpin'), [setPinned]);

  // Whether this identity may post here: always for private rooms; for public rooms,
  // only when the invitation link (or ownership) grants write.
  const canWrite = useMemo(() => {
    if (!session) return false;
    return isPublic ? publicSpaceAuth(session, spaceId).write : true;
  }, [session, isPublic, spaceId]);

  // Offline to the UI = we couldn't open at all (offline, no cache) OR we're showing
  // cached/stale data from the SDK store (built offline, or awaiting a fresh pull).
  const effectiveOffline = offline || storeStale;
  return { store: displayStore, opening: enabled ? opening : false, openError, offline: effectiveOffline, reload, syncError, send, toggleReaction, editMessage, deleteMessage, pinMessage, unpinMessage, uploadAttachment, loadAttachment, canWrite };
}
