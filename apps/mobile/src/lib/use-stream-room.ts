import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { createStore } from 'zustand';
import type { Encryptor, StarfishClient } from '@drakkar.software/starfish-client';

import { makeClient } from './starfish/client';
import { getSpaceEncryptor } from './starfish/space-encryptor';
import { getMemberCap } from './starfish/member-caps';
import { isPublicSpaceId, publicSpaceAuth } from './starfish/pubspace';
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
import type { ConversationStore } from './use-conversation-data';
import type { StoredMsg } from './message-view';
import type { MessageEditEvent, ReactionEvent } from './types';

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
function randomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** One append-log element: a typed envelope so a single log carries messages,
 *  reactions and edits. `t` discriminates; `e` is the payload (a StoredMsg /
 *  ReactionEvent / MessageEditEvent). Sealed as a whole for private streams. */
type StreamEnvelope =
  | { t: 'msg'; e: StoredMsg }
  | { t: 'reaction'; e: ReactionEvent }
  | { t: 'edit'; e: MessageEditEvent };

interface StreamData {
  messages: StoredMsg[];
  reactions: ReactionEvent[];
  edits: MessageEditEvent[];
}

/** A minimal zustand store whose `.data` the chat UI reads via `useStarfishData`.
 *  Only `data` is consumed; the StarfishStore action/flag fields are inert stubs to
 *  satisfy the `ConversationStore` type without pulling in the SDK's sync machinery. */
function makeStreamStore(): ConversationStore {
  return createStore(() => ({
    data: { messages: [], reactions: [], edits: [] } as StreamData,
    syncing: false,
    online: true,
    dirty: false,
    error: null,
    hash: null,
    pull: async () => {},
    set: () => {},
    restore: () => {},
    flush: async () => {},
    setOnline: () => {},
  })) as unknown as ConversationStore;
}

export function useStreamRoom(roomId: string, opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true;
  const { session } = useSession();
  const { ensure: ensureRegistry } = useRoomsRegistryActions();
  const spaceId = spaceIdFromRoomId(roomId);
  const isPublic = isPublicSpaceId(spaceId);
  const [encryptor, setEncryptor] = useState<Encryptor | null>(null);
  const [client, setClient] = useState<StarfishClient | null>(null);
  const [opening, setOpening] = useState(true);
  const [openError, setOpenError] = useState<string | null>(null);

  // The synthetic store is created once and shared for this room's lifetime; pulls
  // replace its `data`. Keyed by roomId so a room switch (the screen stays mounted)
  // starts a fresh, empty store rather than flashing the previous room's log.
  const storeRef = useRef<{ id: string; store: ConversationStore } | null>(null);
  if (!storeRef.current || storeRef.current.id !== roomId) {
    storeRef.current = { id: roomId, store: makeStreamStore() };
  }
  const store = enabled ? storeRef.current.store : null;

  // Open: resolve the sync client (+ encryptor for a private space). Mirrors useRoom's
  // open branches — public spaces authorize with the invite/account cap and carry no
  // encryptor; private spaces open the space keyring encryptor (cached per space).
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset open state before reopening on room/session change
    setEncryptor(null);
    setClient(null);
    setOpenError(null);
    setOpening(true);
    if (!enabled || !session) return;
    (async () => {
      try {
        if (isPublic) {
          const auth = publicSpaceAuth(session, spaceId);
          if (!cancelled) {
            setEncryptor(null);
            setClient(makeClient(auth.cap, auth.signingKey));
            setOpening(false);
          }
          return;
        }
        const reg = getMemberCap(spaceId) ? null : await ensureRegistry(spaceId);
        const { encryptor: enc, client: roomClient } = await getSpaceEncryptor(spaceId, session, reg);
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
  }, [enabled, session, roomId, spaceId, isPublic, ensureRegistry]);

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

  // Pull the append log and fan it into the store's {messages,reactions,edits}.
  // Each element is a {ts,data} envelope; `data` is the sealed payload (private) or
  // the plain envelope (public). A decrypt failure on one element skips just that one.
  const [syncError, setSyncError] = useState<string | null>(null);
  const pull = useCallback(async () => {
    if (!client || !route || !store) return;
    try {
      const items = (await client.pull<{ ts: number; data: Record<string, unknown> }>(route.pull, {
        appendField: 'items',
      })) as { ts: number; data: Record<string, unknown> }[];
      const messages: StoredMsg[] = [];
      const reactions: ReactionEvent[] = [];
      const edits: MessageEditEvent[] = [];
      for (const item of items ?? []) {
        let env: StreamEnvelope | null = null;
        try {
          const payload = encryptor
            ? ((await (encryptor as unknown as { decrypt: (d: Record<string, unknown>) => Promise<unknown> }).decrypt(
                item.data,
              )) as StreamEnvelope)
            : (item.data as unknown as StreamEnvelope);
          env = payload;
        } catch {
          continue; // a single undecryptable element must not blank the whole room
        }
        if (!env) continue;
        // Server-assigned `ts` is the authoritative order/time; stamp it onto the element.
        if (env.t === 'msg') messages.push({ ...env.e, ts: env.e.ts || item.ts });
        else if (env.t === 'reaction') reactions.push({ ...env.e, ts: env.e.ts || item.ts });
        else if (env.t === 'edit') edits.push({ ...env.e, ts: env.e.ts || item.ts });
      }
      store.setState({ data: { messages, reactions, edits } } as never);
      setSyncError((prev) => (prev === null ? prev : null));
    } catch {
      setSyncError('Reconnecting… messages may be out of date.');
    }
  }, [client, route, store, encryptor]);

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

  // Live updates: pull on focus + on the shared SSE bus, with a poll fallback while the
  // SSE stream is down (and always for public spaces, which aren't on the SSE gate).
  // Mirrors useRoom — duplicated rather than shared so useRoom's unread-critical focus
  // logic stays untouched. Skip the store's own absence (disabled / not opened yet).
  const [sseUp, setSseUp] = useState(false);
  useEffect(() => onSseStatus(setSseUp), []);
  const initPulled = useRef<unknown>(null);
  useFocusEffect(
    useCallback(() => {
      if (!store || !client) {
        setSyncError(null);
        return;
      }
      if (initPulled.current === store) void pull();
      else initPulled.current = store;
      return registerPull(roomId, () => void pull());
    }, [store, client, roomId, pull]),
  );
  useEffect(() => {
    if (!store || !client || (sseUp && !isPublic)) return;
    const id = setInterval(() => void pull(), 4000);
    return () => clearInterval(id);
  }, [store, client, sseUp, isPublic, pull]);

  // Signature matches useRoom's `send` so a screen can consume either hook by `kind`
  // (the union call-site stays type-clean). `attachment` is ignored — stream rooms
  // don't support attachments in Phase 1 (the bot-push contract is a plain JSON append).
  const send = useCallback(
    (text: string, parentId?: string, _attachment?: AttachmentRef) => {
      const t = text.trim();
      if (!session || !t) return;
      const msg: StoredMsg = { id: randomId(), authorId: session.userId, ts: Date.now(), text: t };
      if (parentId) msg.parentId = parentId;
      void append({ t: 'msg', e: msg });
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

  // Attachments are not supported in stream rooms (Phase 1): the bot-push contract is a
  // plain JSON append, and public streams have no encryptor to seal a blob. Kept in the
  // returned shape (no-ops) so a room screen can consume useRoom or useStreamRoom alike.
  const uploadAttachment = useCallback(async (_bytes: Uint8Array, _name: string, _mime: string): Promise<AttachmentRef | null> => null, []);
  const loadAttachment = useCallback(async (_ref: AttachmentRef): Promise<Uint8Array | null> => null, []);

  return {
    store,
    opening: enabled ? opening : false,
    openError,
    syncError,
    send,
    toggleReaction,
    editMessage,
    deleteMessage,
    uploadAttachment,
    loadAttachment,
    canWrite: route?.canWrite ?? false,
  };
}
