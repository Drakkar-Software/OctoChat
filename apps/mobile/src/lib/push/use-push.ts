import { useCallback, useEffect, useRef } from 'react';

import { dispatchRoomChange } from '../room-events-bus';
import { useRoomsRegistryActions } from '../rooms-registry-context';
import { useSpacesContext } from '../spaces-context';
import type { Session } from '../starfish/identity';
import {
  ensurePushPermission,
  onForegroundPush,
  onPushOpenNavigate,
  type PushData,
  subscribeSpacePush,
  unsubscribeSpacePush,
} from './fcm';
import { openRoomFromPush } from './open-room-from-push';

/**
 * Subscribe the device to per-space FCM topics for the signed-in user's spaces,
 * mirroring the SSE candidate set. No-op on web (see `fcm.ts`).
 *
 * - Foreground pushes reuse the SSE refetch path: `dispatchRoomChange(roomId)`
 *   pulls the room if it's open (and is a harmless no-op otherwise — the
 *   background handler, not this, drives notifications).
 * - Background/killed-app pushes are shown as local notifications by the handler
 *   registered at module scope in the root layout (`registerBackgroundPushHandler`).
 * - Tapping a notification routes to its room (incl. cold start).
 *
 * `enabled` is the user's master notification toggle: when off, the device drops
 * every topic subscription (no OS banners) but keeps the tap-navigation handlers
 * wired so a notification that's still in the tray routes correctly when opened.
 */
export function usePush(session: Session | null, spaceIds: string[], enabled: boolean): void {
  const subscribed = useRef<Set<string>>(new Set());
  const spacesKey = [...spaceIds].sort().join(',');

  // Notification-tap navigation resolves the room's real name/kind from the rooms
  // registry and focuses its space (see `openRoomFromPush`). The handler is
  // registered once, so the live deps it needs are read through refs.
  const { setActiveId } = useSpacesContext();
  const { ensure } = useRoomsRegistryActions();
  const ensureRef = useRef(ensure);
  const setActiveIdRef = useRef(setActiveId);
  const sessionRef = useRef(session);
  const pendingOpen = useRef<PushData | null>(null);
  useEffect(() => {
    ensureRef.current = ensure;
    setActiveIdRef.current = setActiveId;
    sessionRef.current = session;
  });

  const open = useCallback((data: PushData) => {
    void openRoomFromPush(data, { ensure: ensureRef.current, setActiveId: setActiveIdRef.current });
  }, []);

  const handleOpen = useCallback(
    (data: PushData) => {
      // A cold-start tap can arrive before the session is restored — stash it and
      // let the drain effect route once the session (and its spaces) are ready.
      if (!sessionRef.current) {
        pendingOpen.current = data;
        return;
      }
      open(data);
    },
    [open],
  );

  // Foreground delivery + notification-tap navigation — registered once.
  useEffect(() => {
    const offMessage = onForegroundPush((data) => {
      if (data.roomId) dispatchRoomChange(data.roomId);
    });
    const offOpen = onPushOpenNavigate(handleOpen);
    return () => {
      offMessage();
      offOpen();
    };
  }, [handleOpen]);

  // Drain a tap that arrived before the session was ready (cold start).
  useEffect(() => {
    if (session && pendingOpen.current) {
      const data = pendingOpen.current;
      pendingOpen.current = null;
      open(data);
    }
  }, [session, open]);

  // Reconcile topic subscriptions with the user's current space set. Signing out
  // or turning notifications off drops every subscription.
  useEffect(() => {
    if (!session || !enabled) {
      const drop = subscribed.current;
      subscribed.current = new Set();
      for (const id of drop) void unsubscribeSpacePush(id);
      return;
    }
    let active = true;
    void (async () => {
      if (!(await ensurePushPermission()) || !active) return;
      const next = new Set(spaceIds);
      for (const id of next) {
        if (!subscribed.current.has(id)) await subscribeSpacePush(id);
      }
      for (const id of subscribed.current) {
        if (!next.has(id)) await unsubscribeSpacePush(id);
      }
      subscribed.current = next;
    })();
    return () => {
      active = false;
    };
    // spacesKey is the stable sorted-join of spaceIds — re-runs when the set
    // changes (and when the master toggle flips).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, spacesKey, enabled]);
}
