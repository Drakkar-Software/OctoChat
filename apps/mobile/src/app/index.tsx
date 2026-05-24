import { Redirect } from 'expo-router';

import { useSession } from '@/lib/session-context';

/** Entry: go to the app if an identity is restored, the unlock screen if a sealed
 *  one is waiting (web), else onboarding. */
export default function Index() {
  const { session, status } = useSession();
  if (status === 'loading' || status === 'switching') return null;
  if (status === 'locked') return <Redirect href="/(onboarding)/unlock" />;
  return <Redirect href={session ? '/(tabs)/rooms' : '/(onboarding)/welcome'} />;
}
