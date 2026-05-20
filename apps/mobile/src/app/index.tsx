import { Redirect } from 'expo-router';

/** Entry point — start the demo at the onboarding welcome screen. */
export default function Index() {
  return <Redirect href="/(onboarding)/welcome" />;
}
