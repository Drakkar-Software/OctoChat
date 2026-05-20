import { Redirect } from 'expo-router';

import { useSession } from '@/lib/session-context';

/** Entry: go to the app if an identity is restored, else onboarding. */
export default function Index() {
  const { session, status } = useSession();
  if (status === 'loading') return null;
  return <Redirect href={session ? '/(tabs)/rooms' : '/(onboarding)/welcome'} />;
}
