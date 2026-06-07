import { router } from 'expo-router';
import { Linking, Platform } from 'react-native';

import type { Room } from '@drakkar.software/octochat-sdk';

// The pure message-text parsing lives in the headless SDK; re-export it so
// `@/lib/links` stays the one place the app imports linkify / mention helpers.
export { linkify, matchesUser, mentionsUser } from '@drakkar.software/octochat-sdk';
export type { TextSegment } from '@drakkar.software/octochat-sdk';

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
