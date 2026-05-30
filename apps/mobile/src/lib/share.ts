import { Platform, Share } from 'react-native';

type WebShare = { navigator?: { share?: (data: { text?: string; title?: string }) => Promise<void> } };

/**
 * Open the OS share sheet for a piece of text (a join request, invite cap or
 * link). Native uses React Native's built-in `Share` (no extra dependency); web
 * uses the Web Share API when the browser exposes it. Resolves to whether a
 * share sheet could be opened so callers can hide the affordance where it isn't
 * available (e.g. desktop browsers without `navigator.share`).
 */
export async function shareText(text: string, title?: string): Promise<boolean> {
  try {
    if (Platform.OS !== 'web') {
      await Share.share({ message: text });
      return true;
    }
    const share = (globalThis as WebShare).navigator?.share;
    if (!share) return false;
    await share({ text, title });
    return true;
  } catch {
    return false;
  }
}

/** Whether a share affordance should be shown on this platform. Native only
 *  (Android/iOS) — web/desktop hide the Share button and rely on Copy. */
export function canShare(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}
