import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';

/** The invite credential fragment (everything from the first `#`, the `#` kept)
 *  of a deep-link URL — or `''` when there's none. */
function fragmentOf(url: string | null | undefined): string {
  if (!url) return '';
  const i = url.indexOf('#');
  return i === -1 ? '' : url.slice(i);
}

/**
 * The public-space invite fragment from the URL that launched or resumed the app.
 *
 * Public invite links carry their credential in a `#…` fragment (see
 * `encodePublicInviteLink`) so it never reaches the server. The fragment is
 * dropped by every URL *parser* — Expo Router's path matcher and
 * `Linking.parse()` both discard it — so we read the raw launch URL ourselves:
 *
 * - **web:** `window.location.hash`.
 * - **native:** the raw string from `Linking.getInitialURL()` (cold start) and
 *   the `url` event (warm resume). The OS hands these over with the fragment
 *   intact for custom-scheme, iOS universal-link and Android App-Link opens
 *   alike — only path matching loses it, not the URL itself.
 *
 * Returns the fragment (with leading `#`); the consumer decodes it and guards
 * against re-joining the same token.
 */
export function useInviteFragment(): string {
  const [frag, setFrag] = useState<string>(() =>
    Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.hash : '',
  );

  useEffect(() => {
    // Web reads the hash synchronously in the initializer above; it never
    // arrives via a native `url` event.
    if (Platform.OS === 'web') return;
    let active = true;
    void Linking.getInitialURL().then((url) => {
      const f = fragmentOf(url);
      if (active && f) setFrag(f);
    });
    const sub = Linking.addEventListener('url', ({ url }) => {
      const f = fragmentOf(url);
      if (f) setFrag(f);
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  return frag;
}
