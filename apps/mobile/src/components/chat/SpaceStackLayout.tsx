import { Platform } from 'react-native';
import { Stack } from 'expo-router';

import { useResponsive } from '@/lib/use-responsive';
import { useTheme } from '@/lib/use-theme';

import { ProfileButton } from './ProfileButton';
import { SpaceSwitcherButton } from './SpaceSwitcherButton';

/**
 * Per-tab nav-stack layout shared by the mobile mode tabs (Chat · Agents · Work),
 * which all carry the same space identity. On web it stays headerless — each tab
 * draws the custom {@link SpaceTabHeader} inside its own screen (unchanged). On
 * iOS/Android it gives the tab a REAL native-stack header (iOS 26 Liquid Glass /
 * Material) that hosts the same controls: the space switcher on the left, the
 * profile puck on the right. `expo-router`'s `NativeTabs` can't render a header,
 * so the header lives on this nested Stack instead.
 *
 * No `headerStyle` background is set, so the bar keeps the platform's own chrome
 * — the iOS 26 Liquid Glass / Material translucent material — rather than an
 * opaque paper fill. The switcher renders in `compact` mode (icon + name, name
 * capped so it truncates). Hidden on wide native layouts (iPad / foldable) where
 * the desktop shell owns the chrome.
 */
export default function SpaceStackLayout() {
  const { colors } = useTheme();
  const { isWide } = useResponsive();

  if (Platform.OS === 'web') {
    return <Stack screenOptions={{ headerShown: false }} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: !isWide,
        headerTitle: '',
        // Tint native title text / glyphs to ink; our custom elements carry their
        // own theme colors. No headerStyle bg → keep the OS's translucent material.
        headerTintColor: colors.ink,
        headerLeft: () => <SpaceSwitcherButton compact />,
        headerRight: () => <ProfileButton ring />,
      }}
    />
  );
}
