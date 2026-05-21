import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  loadAttachment as loadAttachmentDoc,
  uploadAttachment as uploadAttachmentDoc,
  type AttachmentRef,
  type ByteSealer,
} from './starfish/attachments';
import { getMemberCap } from './starfish/member-caps';
import { roomPull, roomPush, spaceIdFromRoomId } from './starfish/paths';
import type { ReactionEvent } from './types';
import { useSession } from './session-context';

function randomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Opens an encrypted room: ensures the keyring/encryptor + room doc exist, then
 * builds a synced Zustand store. Live updates via polling (uniform web+native).
 */
export function useRoom(roomId: string) {
  const { session } = useSession();
  const [encryptor, setEncryptor] = useState<Encryptor | null>(null);
  const [client, setClient] = useState<StarfishClient | null>(null);
  const [opening, setOpening] = useState(true);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEncryptor(null);
    setClient(null);
    setOpenError(null);
    setOpening(true);
    if (!session) return;
    // The keyring is space-wide; the room doc stays per-room. A joined space's
    // cap is stored by spaceId, so look it up by the room's space.
    const spaceId = spaceIdFromRoomId(roomId);
    const memberCap = getMemberCap(spaceId);
    (async () => {
      try {
        let enc: Encryptor;
        let roomClient: StarfishClient;
        if (memberCap) {
          // Joined space: open as a keyring recipient, don't try to create it.
          // The space owner (the cap's issuer) is the trusted keyring adder.
          const cap = JSON.parse(memberCap) as { iss?: string };
          roomClient = makeClient(cap, session.keys.edPriv);
          enc = await openEncryptor(roomClient, session.keys, spaceId, cap.iss ? [cap.iss] : []);
        } else {
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
  }, [session, roomId]);

  const config = useMemo(() => {
    if (!session || !encryptor) return null;
    const memberCap = getMemberCap(roomId);
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
  }, [session, encryptor, roomId]);

  const store = useSyncInit(config);

  // Surface repeated sync failures instead of swallowing them: the poll sets a
  // banner on a failed pull and clears it on the next success.
  const [syncError, setSyncError] = useState<string | null>(null);
  useEffect(() => {
    if (!store) {
      setSyncError(null);
      return;
    }
    const tick = () =>
      void store.getState().pull().then(
        () => setSyncError((prev) => (prev === null ? prev : null)),
        () => setSyncError('Reconnecting… messages may be out of date.'),
      );
    tick();
    const id = setInterval(tick, 4000);
    return () => clearInterval(id);
  }, [store]);

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

  /** Seal + upload a file to the room's blob collection, returning its ref. */
  const uploadAttachment = useCallback(
    async (bytes: Uint8Array, name: string, mime: string): Promise<AttachmentRef | null> => {
      if (!client || !encryptor) return null;
      // The room encryptor is a keyring encryptor at runtime — it has the byte
      // seal/open methods even though it's typed as the narrower protocol Encryptor.
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

  return { store, opening, openError, syncError, send, toggleReaction, uploadAttachment, loadAttachment };
}
