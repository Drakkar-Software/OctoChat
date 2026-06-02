import { Platform, StyleSheet, View } from 'react-native';
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
 * The switcher is width-capped so a long space name truncates rather than
 * overrunning the profile control in the native title region. Hidden on wide
 * native layouts (iPad / foldable) where the desktop shell owns the chrome.
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
        headerLeft: () => (
          <View style={styles.left}>
            <SpaceSwitcherButton />
          </View>
        ),
        headerRight: () => <ProfileButton ring />,
        headerStyle: { backgroundColor: colors.paper },
        headerTintColor: colors.ink,
        headerShadowVisible: false,
      }}
    />
  );
}

const styles = StyleSheet.create({
  // Cap the identity so a long space name truncates instead of crowding the
  // profile control on the right.
  left: { maxWidth: 240 },
});
