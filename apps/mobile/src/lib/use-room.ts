import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { createUnionMerge } from '@drakkar.software/starfish-client';
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';
import { useSyncInit } from '@drakkar.software/starfish-client/zustand';

import { SYNC_BASE, SYNC_NAMESPACE } from './starfish/config';
import { capProviderFor, ensureRoomInitialized, makeClient } from './starfish/client';
import { fetchWithTimeout } from './starfish/fetch-timeout';
import { registerPull, onSseStatus } from './room-events-bus';
import {
  loadAttachment as loadAttachmentDoc,
  uploadAttachment as uploadAttachmentDoc,
  type AttachmentRef,
  type ByteSealer,
} from './starfish/attachments';
import { getMemberCap } from './starfish/member-caps';
import { getSpaceEncryptor } from './starfish/space-encryptor';
import { isPublicSpaceId, publicSpaceAuth } from './starfish/pubspace';
import { pubspaceRoomPull, pubspaceRoomPush, roomPull, roomPush, spaceIdFromRoomId } from './starfish/paths';
import type { MessageEditEvent, PinEvent, ReactionEvent } from './types';
import { useRoomsRegistryActions } from './rooms-registry-context';
import { useSession } from './session-context';
import { makeEmptyConversationStore, type ConversationStore } from './use-conversation-data';
import { useRoomOpenState } from './use-room-open';
import { randomId } from './ids';

/**
 * Opens a room and builds a synced Zustand store. Two modes by the room's space:
 *  - PRIVATE (E2EE): ensure the space keyring/encryptor + room doc exist, sync with
 *    the encryptor (sealed messages). Joiners open as keyring recipients.
 *  - PUBLIC (plaintext): NO keyring/encryptor — authorize with the invitation cap
 *    (joiner) or the account cap (owner) and sync the plaintext `pubspaces/…` doc.
 * Live updates via the shared SSE bus with a polling fallback (uniform web+native).
 *
 * MUST be called from a router screen: it gates its live pull on `useFocusEffect`,
 * which needs a navigator context. Both callers (room/[id], thread/[id]) are screens.
 */
export function useRoom(roomId: string, opts: { enabled?: boolean } = {}) {
  // `enabled` lets a screen call this AND useStreamRoom unconditionally (React hook
  // rules) and pick one by the room's kind. When false this hook opens nothing.
  const enabled = opts.enabled ?? true;
  const { session } = useSession();
  const { ensure: ensureRegistry } = useRoomsRegistryActions();
  const spaceId = spaceIdFromRoomId(roomId);
  const isPublic = isPublicSpaceId(spaceId);
  const [encryptor, setEncryptor] = useState<Encryptor | null>(null);
  const [client, setClient] = useState<StarfishClient | null>(null);
  // Shared open-state machine (offline-classification + reconnect re-open) — see
  // {@link useRoomOpenState}. While offline the SDK store can't build (no encryptor),
  // so it stays null and we render the empty fallback store below; on reconnect the
  // hook bumps `reloadNonce` to re-run the open effect and pull.
  const { opening, openError, offline, reloadNonce, reload, beginOpen, openReached, finishOpening, failOpen } =
    useRoomOpenState();

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset room crypto/open state before reopening when room or session changes
    setEncryptor(null);
    setClient(null);
    beginOpen();
    if (!enabled || !session) return;
    (async () => {
      try {
        if (isPublic) {
          // Public space: no keyring, no encryptor. Authorize with the invite cap
          // (joiner) or the account cap (owner) — see publicSpaceAuth.
          const auth = publicSpaceAuth(session, spaceId);
          if (!cancelled) {
            setEncryptor(null);
            setClient(makeClient(auth.cap, auth.signingKey));
            finishOpening(); // public open did no network call — proves no reachability
          }
          return;
        }
        // PRIVATE: the keyring is space-wide (cached per space; see getSpaceEncryptor),
        // the room doc is per-room. With no stored member cap we need the registry
        // owner for the owner-vs-no-access decision — read it once via the SHARED rooms
        // registry rather than a private `readRooms`, so the room screen and sidebar
        // don't each pull it. `ensureRoomInitialized` is per-ROOM, so it runs here.
        const reg = getMemberCap(spaceId) ? null : await ensureRegistry(spaceId);
        const { encryptor: enc, client: roomClient, isOwnerOpen } = await getSpaceEncryptor(spaceId, session, reg);
        if (isOwnerOpen) await ensureRoomInitialized(session.chatClient, enc, roomId);
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
    };
  }, [enabled, session, client, encryptor, roomId, spaceId, isPublic]);

  const store = useSyncInit(config);

  // Offline fallback store. The SDK store can't build without the encryptor, so it's
  // null while offline — hand the screen an EMPTY store instead so the conversation
  // view (and the pending outbox bubbles merged into it) still renders rather than a
  // hard error. Keyed by roomId so a room switch starts empty, not on the prior room.
  // Only the RETURNED `store` falls back; the internal `store` (above) stays the real
  // SDK one, so `send`/pull/etc. never write to this inert store.
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

  // Track the global SSE stream's health for the fallback poll below. Always on
  // (even while this screen is backgrounded) so the poll's gate stays accurate.
  const [sseUp, setSseUp] = useState(false);
  useEffect(() => onSseStatus(setSseUp), []);

  // Live updates, gated on this room screen being FOCUSED. On focus we pull once
  // and register a pull on the global SSE bus so new messages arrive live while
  // the room is open (UnreadProvider holds the single shared SSE connection — no
  // second connection here). Registering ONLY while focused is the crux of the
  // unread-badge fix: a room screen left mounted *underneath* a pushed screen (you
  // opened another channel or a thread) must release its registration, or
  // UnreadProvider's dispatchRoomChange keeps treating it as the active room and
  // silently pulls its change-events instead of bumping the unread count. On blur
  // we unregister so a backgrounded room accrues unread like any unopened one.
  // Tradeoff: a backgrounded room no longer live-updates its (invisible) message
  // store — the pull-on-focus refresh covers re-entry. This is intentional.
  // The sync store already pulls once when it's created (SDK `useSyncInit`), so skip
  // the duplicate pull on the FIRST focus right after a store appears; re-focus
  // (returning from a thread, or re-entering the room) still pulls to catch up.
  // Keyed by store identity so a fresh store (room switch / reopen) also skips its own
  // init-pull's first focus.
  const initPulledStore = useRef<unknown>(null);
  useFocusEffect(
    useCallback(() => {
      if (!store) { setSyncError(null); return; }
      if (initPulledStore.current === store) pull();
      else initPulledStore.current = store;
      return registerPull(roomId, pull);
    }, [store, roomId, pull]),
  );

  // Fallback: poll only while the SSE stream is unreachable/disconnected, so a
  // client without the gateway still receives new messages. Public rooms now ride
  // the same /events stream as private ones (the proxy open-gates `psp-` spaces),
  // so they poll only when SSE is down — no longer on every tick.
  useEffect(() => {
    if (!store || sseUp) return;
    const id = setInterval(pull, 4000);
    return () => clearInterval(id);
  }, [store, sseUp, pull]);

  // `id` lets a queued (offline) message reuse the id its pending bubble already
  // showed, so when it finally syncs it dedups against the bubble instead of
  // double-rendering (see outbox.ts). Live sends omit it and mint a fresh id.
  // Returns whether the message was APPLIED to the synced store: `false` when there's
  // no store yet (offline — the SDK store can't build without the encryptor) so the
  // caller (use-room-send) diverts it to the offline outbox instead of dropping it.
  // This makes queueing depend on the real send outcome, not on the (fallible) online
  // flag — the bug where an offline send no-op'd into a null store and vanished.
  const send = useCallback(
    (text: string, parentId?: string, attachment?: AttachmentRef, id?: string): boolean => {
      const t = text.trim();
      if (!store || !session || (!t && !attachment)) return false;
      store.getState().set((d: Record<string, unknown>) => {
        const msgs = (d.messages as unknown[]) ?? [];
        const msg: Record<string, unknown> = { id: id ?? randomId(), authorId: session.userId, ts: Date.now() };
        if (t) msg.text = t;
        if (parentId) msg.parentId = parentId;
        if (attachment) msg.attachment = attachment;
        return { ...d, messages: [...msgs, msg] };
      });
      return true;
    },
    [store, session],
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

  const toggleReaction = useCallback(
    (msgId: string, emoji: string) => {
      if (!store || !session) return;
      const me = session.userId;
      store.getState().set((d: Record<string, unknown>) => {
        const events = ((d.reactions as ReactionEvent[]) ?? []).slice();
        const net = events
          .filter((e) => e.msgId === msgId && e.emoji === emoji && e.userId === me)
          .reduce((n, e) => n + (e.kind === 'add' ? 1 : -1), 0);
        events.push({ id: randomId(), msgId, emoji, userId: me, kind: net > 0 ? 'remove' : 'add', ts: Date.now() });
        return { ...d, reactions: events };
      });
    },
    [store, session],
  );

  // Edit/delete are append-only events keyed by msgId (mirrors `toggleReaction`),
  // folded at render by `resolveEdit`. The author check there is the real guard;
  // these only fire from the UI for the viewer's own messages.
  const editMessage = useCallback(
    (msgId: string, text: string) => {
      const t = text.trim();
      if (!store || !session || !t) return;
      store.getState().set((d: Record<string, unknown>) => {
        const events = ((d.edits as MessageEditEvent[]) ?? []).slice();
        events.push({ id: randomId(), msgId, userId: session.userId, kind: 'edit', text: t, ts: Date.now() });
        return { ...d, edits: events };
      });
    },
    [store, session],
  );

  const deleteMessage = useCallback(
    (msgId: string) => {
      if (!store || !session) return;
      store.getState().set((d: Record<string, unknown>) => {
        const events = ((d.edits as MessageEditEvent[]) ?? []).slice();
        events.push({ id: randomId(), msgId, userId: session.userId, kind: 'delete', ts: Date.now() });
        return { ...d, edits: events };
      });
    },
    [store, session],
  );

  // Pin/unpin are append-only events keyed by msgId (mirrors edit/delete), folded at
  // render by `resolvePinned`. Unlike edits the guard there is the SPACE OWNER, not
  // the author — these only fire from the UI for the owner, but the fold is the real
  // gate. `pin` re-sends idempotently; the latest event by `ts` wins.
  const setPinned = useCallback(
    (msgId: string, kind: 'pin' | 'unpin') => {
      if (!store || !session) return;
      store.getState().set((d: Record<string, unknown>) => {
        const events = ((d.pins as PinEvent[]) ?? []).slice();
        events.push({ id: randomId(), msgId, userId: session.userId, kind, ts: Date.now() });
        return { ...d, pins: events };
      });
    },
    [store, session],
  );
  const pinMessage = useCallback((msgId: string) => setPinned(msgId, 'pin'), [setPinned]);
  const unpinMessage = useCallback((msgId: string) => setPinned(msgId, 'unpin'), [setPinned]);

  // Whether this identity may post here: always for private rooms; for public rooms,
  // only when the invitation link (or ownership) grants write.
  const canWrite = useMemo(() => {
    if (!session) return false;
    return isPublic ? publicSpaceAuth(session, spaceId).write : true;
  }, [session, isPublic, spaceId]);

  return { store: displayStore, opening: enabled ? opening : false, openError, offline, reload, syncError, send, toggleReaction, editMessage, deleteMessage, pinMessage, unpinMessage, uploadAttachment, loadAttachment, canWrite };
}
