import { useCallback, useEffect, useMemo, useState } from 'react';
import { createUnionMerge } from '@drakkar.software/starfish-client';
import type { Encryptor } from '@drakkar.software/starfish-client';
import { useSyncInit } from '@drakkar.software/starfish-client/zustand';

import { SYNC_BASE } from './starfish/config';
import {
  capProviderFor,
  ensureMembersInitialized,
  ensureRoomInitialized,
  makeClient,
  openEncryptor,
  ownerEnsureKeyring,
} from './starfish/client';
import { getMemberCap } from './starfish/member-caps';
import { roomPull, roomPush } from './starfish/paths';
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
  const [opening, setOpening] = useState(true);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEncryptor(null);
    setOpenError(null);
    setOpening(true);
    if (!session) return;
    const memberCap = getMemberCap(roomId);
    (async () => {
      try {
        let enc: Encryptor | null;
        if (memberCap) {
          // Joined room: open as a keyring recipient, don't try to create it.
          // The room owner (the cap's issuer) is the trusted keyring adder.
          const cap = JSON.parse(memberCap) as { iss?: string };
          const client = makeClient(cap, session.keys.edPriv);
          enc = await openEncryptor(client, session.keys, roomId, cap.iss ? [cap.iss] : []);
        } else {
          enc = await ownerEnsureKeyring(session.chatClient, session.keys, roomId);
          await ensureRoomInitialized(session.chatClient, enc, roomId);
          await ensureMembersInitialized(session.chatClient, roomId).catch(() => {});
        }
        if (!cancelled) {
          setEncryptor(enc);
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
    (text: string, parentId?: string) => {
      const t = text.trim();
      if (!store || !t || !session) return;
      store.getState().set((d: Record<string, unknown>) => {
        const msgs = (d.messages as unknown[]) ?? [];
        const msg: Record<string, unknown> = { id: randomId(), authorId: session.userId, text: t, ts: Date.now() };
        if (parentId) msg.parentId = parentId;
        return { ...d, messages: [...msgs, msg] };
      });
    },
    [store, session],
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

  return { store, opening, openError, syncError, send, toggleReaction };
}
