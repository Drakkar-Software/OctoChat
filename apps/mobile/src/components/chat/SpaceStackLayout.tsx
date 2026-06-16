import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { useResponsive } from '@/lib/use-responsive';
import { useSpaceHeader } from '@/lib/use-space-header';
import { useRooms } from '@/lib/use-rooms';
import { useTheme } from '@/lib/use-theme';

import { CreateRoomButton } from './CreateRoomButton';
import { SpaceSwitcherButton } from './SpaceSwitcherButton';

/**
 * Per-tab nav-stack layout shared by the mobile mode tabs (Chat · Agents · Work),
 * which all carry the same space identity. On web it stays headerless — each tab
 * draws the custom {@link SpaceTabHeader} inside its own screen (unchanged). On
 * iOS/Android it gives the tab a REAL native-stack header (iOS 26 Liquid Glass /
 * Material) with the space switcher centered as the title and an owner-gated
 * create-room "+" on the right. `expo-router`'s `NativeTabs` can't render a
 * header, so the header lives on this nested Stack instead.
 *
 * `headerTransparent` lets the screen body scroll UNDER the bar (the screen pads
 * its content down past it — see {@link StackScreen} `headerProvidedNatively}),
 * and `headerBlurEffect` blurs that content through the bar — the iOS 26 Liquid
 * Glass / Material look. Without transparency the bar would reserve its own opaque
 * strip and the canvas wouldn't sit behind it, reading as a blank gap. Hidden on
 * wide native layouts (iPad / foldable) where the desktop shell owns the chrome.
 */
export default function SpaceStackLayout() {
  const { colors, scheme } = useTheme();
  const { isWide } = useResponsive();
  const { space, isDmHome, activeId } = useSpaceHeader();
  const { isOwner } = useRooms(isDmHome ? null : activeId);
  const dark = scheme === 'dark';
  const showCreateRoom = !isDmHome && !!space && isOwner;

  if (Platform.OS === 'web') {
    return <Stack screenOptions={{ headerShown: false }} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: !isWide,
        headerTitle: () => <SpaceSwitcherButton />,
        headerTitleAlign: 'center',
        // Tint native title text / glyphs to ink; our custom elements carry their
        // own theme colors.
        headerTintColor: colors.ink,
        // Transparent + blur so the canvas scrolls UNDER the bar and shows through
        // it (the OS translucent material), instead of the bar reserving an opaque
        // strip that reads as a blank gap on iOS.
        headerTransparent: true,
        headerBlurEffect: dark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight',
        headerRight: showCreateRoom ? () => <CreateRoomButton /> : undefined,
      }}
    />
  );
}

