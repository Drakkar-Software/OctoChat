import { Platform } from 'react-native';
import { Redirect } from 'expo-router';

import { useSession } from '@/lib/session-context';
import { LandingPage } from '@/components/LandingPage';

/** Entry: show the marketing landing page on web when unauthenticated; otherwise
 *  go to the app, the unlock screen, or native onboarding. */
export default function Index() {
  const { session, status } = useSession();
  if (status === 'loading' || status === 'switching') return null;
  if (status === 'locked') return <Redirect href="/(onboarding)/unlock" />;
  if (session) return <Redirect href="/(tabs)/rooms" />;
  if (Platform.OS === 'web') return <LandingPage />;
  return <Redirect href="/(onboarding)/welcome" />;
}
