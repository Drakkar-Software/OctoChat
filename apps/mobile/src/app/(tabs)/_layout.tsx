import { Tabs } from 'expo-router';
// Pulled from expo-router's bundled bottom-tabs so the custom `tabBar` slot can
// fall through to the default renderer while we stack the update banner above it.
import { BottomTabBar } from 'expo-router/build/react-navigation/bottom-tabs';
import { StyleSheet, View, type ColorValue } from 'react-native';

import { fonts, radii, spacing } from '@/theme';
import { useResponsive } from '@/lib/use-responsive';
import { useTheme } from '@/lib/use-theme';
import { Icon, type IconName } from '@/components/ui/Icon';
import { DesktopUpdateBanner } from '@/components/ui/DesktopUpdateBanner';

/** Tab icon with a Material-style accent pill behind the active tab. */
function TabBarIcon({ name, color, size, focused }: { name: IconName; color: string; size: number; focused: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.iconWrap, focused && { backgroundColor: colors.accentBg }]}>
      <Icon name={name} size={size} color={color} />
    </View>
  );
}

const tabIcon = (name: IconName) => {
  // expo-router/RN types `color` as ColorValue; our tab tints are string theme
  // tokens (colors.accent / colors.inkMuted), so coerce at the boundary.
  const TabIcon = ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => (
    <TabBarIcon name={name} color={color as string} size={size} focused={focused} />
  );
  TabIcon.displayName = `TabIcon(${name})`;
  return TabIcon;
};

export default function TabsLayout() {
  const { colors } = useTheme();
  const { isWide } = useResponsive();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.inkMuted,
        // On wide screens the desktop sidebar replaces the bottom tab bar.
        tabBarStyle: isWide
          ? { display: 'none' }
          : { backgroundColor: colors.paper, borderTopColor: colors.lineSoft },
        tabBarLabelStyle: { fontFamily: fonts.bodyMedium, fontSize: 10 },
        tabBarIconStyle: { marginTop: 2 },
      }}
      // Wraps the default tab bar so the update banner sits just above it on
      // mobile. On wide screens the bar is hidden anyway and AppFrame renders the
      // banner at the top instead.
      tabBar={(props) => (
        <View>
          {!isWide ? <DesktopUpdateBanner /> : null}
          <BottomTabBar {...props} />
        </View>
      )}
    >
      <Tabs.Screen name="rooms" options={{ title: 'Rooms', tabBarIcon: tabIcon('hash') }} />
      <Tabs.Screen name="threads" options={{ title: 'Threads', tabBarIcon: tabIcon('thread') }} />
      <Tabs.Screen name="you" options={{ title: 'You', tabBarIcon: tabIcon('user') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    minWidth: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
