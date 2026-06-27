import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Redirect } from 'expo-router';

import { useSession } from '@/lib/session-context';
import { LandingPage } from '@/components/LandingPage';

/** Entry: show the marketing landing page on web when unauthenticated; otherwise
 *  go to the app, the unlock screen, or native onboarding. */
export default function Index() {
  const { session, status } = useSession();

  // Performance baseline marker — TTI = nativeLaunchStart → screenInteractive.
  // Fires the first time the session resolves (status leaves 'loading') so the mark
  // captures the full cold-start path: native init → JS bundle → session vault read.
  // Record a COLD start only (kill the app between runs; ignore warm / prewarmed).
  // Compare: nativeLaunchStart, runJSBundleStart/End, contentAppeared (all automatic
  // from react-native-performance) → screenInteractive below.
  // eslint-disable-next-line react-hooks/rules-of-hooks -- conditional after hook is fine; status is always defined
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (status === 'loading' || status === 'switching') return;
    // Dynamic import keeps react-native-performance out of the main bundle graph on
    // platforms or builds where it isn't needed (e.g. web). The import() call itself
    // is synchronous in the Metro graph but the mark cost is negligible.
    void import('react-native-performance').then(({ default: perf }) => {
      perf.mark('screenInteractive');
    });
  }, [status]);

  if (status === 'loading' || status === 'switching') return null;
  if (status === 'locked') return <Redirect href="/(onboarding)/unlock" />;
  // 'authenticating': vault ready + account known — mount the tab shell immediately
  // so the native tab bar paints and is tappable while the session resolves.
  // The session is still null here; screens show their empty/skeleton states via
  // SignInPrompt (returns null for 'authenticating') until 'ready' fills them in.
  if (status === 'authenticating' || session) return <Redirect href="/(tabs)/rooms" />;
  if (Platform.OS === 'web') return <LandingPage />;
  return <Redirect href="/(onboarding)/welcome" />;
}
