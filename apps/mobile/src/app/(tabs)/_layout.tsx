import { Tabs } from 'expo-router';
import { StyleSheet, View, type ColorValue } from 'react-native';

import { fonts, radii, spacing } from '@/theme';
import { useResponsive } from '@/lib/use-responsive';
import { useTheme } from '@/lib/use-theme';
import { useUnread } from '@/lib/unread-context';
import { Icon, type IconName } from '@/components/ui/Icon';

/** Tab icon with a Material-style accent pill behind the active tab. */
function TabBarIcon({ name, color, size, focused }: { name: IconName; color: string; size: number; focused: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.iconWrap, focused && { backgroundColor: colors.accentBg }]}>
      <Icon name={name} size={size} color={color} />
    </View>
  );
}

const tabIcon =
  (name: IconName) =>
  // expo-router/RN types `color` as ColorValue; our tab tints are string theme
  // tokens (colors.accent / colors.inkMuted), so coerce at the boundary.
  ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => (
    <TabBarIcon name={name} color={color as string} size={size} focused={focused} />
  );

export default function TabsLayout() {
  const { colors } = useTheme();
  const { isWide } = useResponsive();
  const { totalUnread } = useUnread();
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
    >
      <Tabs.Screen name="rooms" options={{ title: 'Rooms', tabBarIcon: tabIcon('hash') }} />
      <Tabs.Screen name="search" options={{ title: 'Search', tabBarIcon: tabIcon('search') }} />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: tabIcon('bell'),
          tabBarBadge: totalUnread > 0 ? (totalUnread > 99 ? '99+' : totalUnread) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.unread, fontFamily: fonts.bodyMedium, fontSize: 10 },
        }}
      />
      <Tabs.Screen name="you" options={{ title: 'You', tabBarIcon: tabIcon('people') }} />
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
