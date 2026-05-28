import Feather from '@expo/vector-icons/Feather';
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { fonts } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { useUnread } from '@/lib/unread-context';

/**
 * Native (iOS / Android) bottom tabs. Renders the real platform tab bar —
 * SwiftUI `UITabBar` (liquid glass on iOS 26) / Material 3 bottom navigation —
 * via Expo Router's `NativeTabs`. The web/PWA build keeps the JS `Tabs`
 * renderer in `_layout.tsx` (Metro resolves this `.native.tsx` variant only on
 * native), which is also where the desktop sidebar swap and the OTA update
 * banner live.
 *
 * The `search` route is not a tab here: it lives at the app root and is reached
 * via `router.push('/search')` from the rooms header and room screen — native
 * tabs have no `href: null` equivalent (a `hidden` trigger is non-navigable).
 *
 * Icons stay on the app's Feather line-art vocabulary (via `VectorIcon`) so the
 * tab glyphs match the rest of the UI; the native feel comes from the bar
 * itself. `totalUnread` drives the Activity badge.
 */
export default function NativeTabsLayout() {
  const { colors } = useTheme();
  const { totalUnread } = useUnread();
  const badge = totalUnread > 0 ? (totalUnread > 99 ? '99+' : String(totalUnread)) : undefined;
  return (
    <NativeTabs
      // Active icon + label resolve to `tintColor`; inactive fall back to the
      // muted defaults below — mirroring the JS-Tabs active/inactive tints.
      tintColor={colors.accent}
      backgroundColor={colors.paper}
      iconColor={{ default: colors.inkMuted }}
      badgeBackgroundColor={colors.unread}
      labelStyle={{
        default: { fontFamily: fonts.bodyMedium, color: colors.inkMuted },
        selected: { fontFamily: fonts.bodyMedium, color: colors.accent },
      }}
    >
      <NativeTabs.Trigger name="rooms">
        <NativeTabs.Trigger.Label>Rooms</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={<NativeTabs.Trigger.VectorIcon family={Feather} name="hash" />} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="activity">
        <NativeTabs.Trigger.Label>Activity</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={<NativeTabs.Trigger.VectorIcon family={Feather} name="bell" />} />
        <NativeTabs.Trigger.Badge hidden={!badge}>{badge}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="you">
        <NativeTabs.Trigger.Label>You</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={<NativeTabs.Trigger.VectorIcon family={Feather} name="user" />} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
