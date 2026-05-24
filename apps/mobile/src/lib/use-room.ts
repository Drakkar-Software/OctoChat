import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { createUnionMerge } from '@drakkar.software/starfish-client';
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';
import { useSyncInit } from '@drakkar.software/starfish-client/zustand';

import { SYNC_BASE } from './starfish/config';
import {
  capProviderFor,
  ensureRoomInitialized,
  makeClient,
  openEncryptor,
  ownerEnsureKeyring,
} from './starfish/client';
import { registerPull, onSseStatus } from './room-events-bus';
import {
  loadAttachment as loadAttachmentDoc,
  uploadAttachment as uploadAttachmentDoc,
  type AttachmentRef,
  type ByteSealer,
} from './starfish/attachments';
import { getMemberCap } from './starfish/member-caps';
import { readRooms } from './starfish/registry';
import { isPublicSpaceId, publicSpaceAuth } from './starfish/pubspace';
import { pubspaceRoomPull, pubspaceRoomPush, roomPull, roomPush, spaceIdFromRoomId } from './starfish/paths';
import type { MessageEditEvent, ReactionEvent } from './types';
import { useSession } from './session-context';

function randomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

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
export function useRoom(roomId: string) {
  const { session } = useSession();
  const spaceId = spaceIdFromRoomId(roomId);
  const isPublic = isPublicSpaceId(spaceId);
  const [encryptor, setEncryptor] = useState<Encryptor | null>(null);
  const [client, setClient] = useState<StarfishClient | null>(null);
  const [opening, setOpening] = useState(true);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset room crypto/open state before reopening when room or session changes
    setEncryptor(null);
    setClient(null);
    setOpenError(null);
    setOpening(true);
    if (!session) return;
    (async () => {
      try {
        if (isPublic) {
          // Public space: no keyring, no encryptor. Authorize with the invite cap
          // (joiner) or the account cap (owner) — see publicSpaceAuth.
          const auth = publicSpaceAuth(session, spaceId);
          if (!cancelled) {
            setEncryptor(null);
            setClient(makeClient(auth.cap, auth.signingKey));
            setOpening(false);
          }
          return;
        }
        // PRIVATE: the keyring is space-wide; the room doc is per-room. A joined
        // space's cap is stored by spaceId, so look it up by the room's space.
        const memberCap = getMemberCap(spaceId);
        let enc: Encryptor;
        let roomClient: StarfishClient;
        if (memberCap) {
          // Joined space: open as a keyring recipient; the cap's issuer is the
          // trusted keyring adder.
          const cap = JSON.parse(memberCap) as { iss?: string };
          roomClient = makeClient(cap, session.keys.edPriv);
          enc = await openEncryptor(roomClient, session.keys, spaceId, cap.iss ? [cap.iss] : []);
        } else {
          // No local cap. Only the genuine OWNER may create/own the space keyring. A
          // member whose cap hasn't hydrated must NOT fall into the owner branch — that
          // would fail the keyring's trustedAdders check with a confusing "no wrapped
          // key" error and could re-create the keyring, locking everyone out. Decide
          // from the authoritative registry owner (null ⇒ legacy/unreadable: treat as
          // owner, as before). The cap normally self-heals via the synced `_spaces` doc.
          const { owner, members } = await readRooms(session.accountClient, spaceId);
          if (owner !== null && owner !== session.userId) {
            throw new Error(
              members.includes(session.userId)
                ? "You're a member of this space, but its key isn't on this device yet — reconnect, or ask the owner to re-invite."
                : "You don't have access to this space.",
            );
          }
          roomClient = session.chatClient;
          enc = await ownerEnsureKeyring(session.chatClient, session.keys, spaceId);
          await ensureRoomInitialized(session.chatClient, enc, roomId);
        }
        if (!cancelled) {
          setEncryptor(enc);
          setClient(roomClient);
          setOpening(false);
        }
      } catch (e) {
        if (!cancelled) {
          setOpenError(String((e as Error)?.message ?? e));
          setOpening(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, roomId, spaceId, isPublic]);

  const config = useMemo(() => {
    if (!session || !client) return null;
    if (isPublic) {
      // Plaintext sync: no `encryptor` (the SDK treats its absence as plaintext).
      const auth = publicSpaceAuth(session, spaceId);
      return {
        serverUrl: SYNC_BASE,
        capProvider: capProviderFor(auth.cap, auth.signingKey),
        pullPath: pubspaceRoomPull(auth.ownerId, spaceId, roomId),
        pushPath: pubspaceRoomPush(auth.ownerId, spaceId, roomId),
        onConflict: createUnionMerge(),
        storeName: `pub-${session.userId}-${roomId}`,
        storage: false as const,
      };
    }
    if (!encryptor) return null;
    const memberCap = getMemberCap(spaceId);
    const cap = memberCap ? JSON.parse(memberCap) : session.chatCap;
    return {
      serverUrl: SYNC_BASE,
      capProvider: capProviderFor(cap, session.keys.edPriv),
      pullPath: roomPull(roomId),
      pushPath: roomPush(roomId),
      encryptor,
      onConflict: createUnionMerge(),
      storeName: `chat-${session.userId}-${roomId}`,
      storage: false as const,
    };
  }, [session, client, encryptor, roomId, spaceId, isPublic]);

  const store = useSyncInit(config);

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
  useFocusEffect(
    useCallback(() => {
      if (!store) { setSyncError(null); return; }
      pull();
      return registerPull(roomId, pull);
    }, [store, roomId, pull]),
  );

  // Fallback: poll only while the SSE stream is unreachable/disconnected, so a
  // client without the gateway still receives new messages. Public spaces aren't
  // covered by the space SSE gate, so they rely on this poll for live updates.
  useEffect(() => {
    if (!store || (sseUp && !isPublic)) return;
    const id = setInterval(pull, 4000);
    return () => clearInterval(id);
  }, [store, sseUp, isPublic, pull]);

  const send = useCallback(
    (text: string, parentId?: string, attachment?: AttachmentRef) => {
      const t = text.trim();
      if (!store || !session || (!t && !attachment)) return;
      store.getState().set((d: Record<string, unknown>) => {
        const msgs = (d.messages as unknown[]) ?? [];
        const msg: Record<string, unknown> = { id: randomId(), authorId: session.userId, ts: Date.now() };
        if (t) msg.text = t;
        if (parentId) msg.parentId = parentId;
        if (attachment) msg.attachment = attachment;
        return { ...d, messages: [...msgs, msg] };
      });
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

  // Whether this identity may post here: always for private rooms; for public rooms,
  // only when the invitation link (or ownership) grants write.
  const canWrite = useMemo(() => {
    if (!session) return false;
    return isPublic ? publicSpaceAuth(session, spaceId).write : true;
  }, [session, isPublic, spaceId]);

  return { store, opening, openError, syncError, send, toggleReaction, editMessage, deleteMessage, uploadAttachment, loadAttachment, canWrite };
}
