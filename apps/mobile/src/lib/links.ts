import { router } from 'expo-router';
import { Linking, Platform } from 'react-native';

import type { Room } from '@drakkar.software/octochat-sdk';

import { WEB_BASE } from '@/lib/octochat-config';

// The pure message-text parsing lives in the headless SDK; re-export it so
// `@/lib/links` stays the one place the app imports linkify / mention helpers.
export { linkify, matchesUser, mentionsUser } from '@drakkar.software/octochat-sdk';
export type { TextSegment } from '@drakkar.software/octochat-sdk';

/** Origin for shareable invite links: the live web origin on web, else the
 *  configured universal-links domain (`WEB_BASE`) so native-minted links are full
 *  `https://<domain>/…#…` URLs that open the app. '' yields a host-less link.
 *  Shared by space invites (space settings) and "DM me" links (use-dm-link). */
export function webOrigin(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return WEB_BASE;
}

type Win = { open?: (url: string, target?: string, features?: string) => unknown };

/** Open an external link in a new tab on web, or the system handler on native. */
export function openUrl(url: string): void {
  if (Platform.OS === 'web') {
    (globalThis as Win).open?.(url, '_blank', 'noopener,noreferrer');
    return;
  }
  void Linking.openURL(url);
}

/** Navigate to a channel from a `#mention`. */
export function openRoom(room: Room): void {
  router.push({ pathname: '/room/[id]', params: { id: room.id, name: room.name, kind: room.kind } });
}
