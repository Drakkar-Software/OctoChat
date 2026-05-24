import { useEffect, useRef } from 'react';

import { dispatchRoomChange } from '../room-events-bus';
import type { Session } from '../starfish/identity';
import {
  ensurePushPermission,
  onForegroundPush,
  onPushOpenNavigate,
  subscribeSpacePush,
  unsubscribeSpacePush,
} from './fcm';

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

  // Foreground delivery + notification-tap navigation — registered once.
  useEffect(() => {
    const offMessage = onForegroundPush((data) => {
      if (data.roomId) dispatchRoomChange(data.roomId);
    });
    const offOpen = onPushOpenNavigate();
    return () => {
      offMessage();
      offOpen();
    };
  }, []);

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
