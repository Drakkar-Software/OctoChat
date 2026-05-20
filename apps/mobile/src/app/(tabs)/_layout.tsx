import { Tabs } from 'expo-router';

import { fonts } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Icon, type IconName } from '@/components/ui/Icon';

const tabIcon =
  (name: IconName) =>
  ({ color, size }: { color: string; size: number }) => <Icon name={name} size={size} color={color} />;

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: { backgroundColor: colors.paper, borderTopColor: colors.lineSoft },
        tabBarLabelStyle: { fontFamily: fonts.bodyMedium, fontSize: 10 },
      }}
    >
      <Tabs.Screen name="rooms" options={{ title: 'Rooms', tabBarIcon: tabIcon('hash') }} />
      <Tabs.Screen name="search" options={{ title: 'Search', tabBarIcon: tabIcon('search') }} />
      <Tabs.Screen name="activity" options={{ title: 'Activity', tabBarIcon: tabIcon('bell') }} />
      <Tabs.Screen name="you" options={{ title: 'You', tabBarIcon: tabIcon('people') }} />
    </Tabs>
  );
}
