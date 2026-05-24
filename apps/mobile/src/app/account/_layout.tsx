import { Stack } from 'expo-router';

/**
 * In-app "add another account" flow (chooser → create / recover). Kept out of the
 * `(onboarding)` stack on purpose so adding an account never re-enters the
 * front-door welcome screen; it appends to the already-unlocked vault instead.
 */
export default function AccountLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
