import Feather from '@expo/vector-icons/Feather';
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { fonts } from '@/theme';
import { useResponsive } from '@/lib/use-responsive';
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
 * The tabs ARE the workspace modes (Chat · Agents · Work).
 * `search`, `threads` and `you` are NOT tabs: they live at the app root and are
 * reached via `router.push(...)` from the Chat tab / its header — native tabs
 * have no `href: null` equivalent (a `hidden` trigger is non-navigable).
 *
 * Icons stay on the app's Feather line-art vocabulary (via `VectorIcon`) so the
 * tab glyphs match the rest of the UI; the native feel comes from the bar
 * itself. `totalUnread` (every unread message across rooms — thread replies
 * included, since a reply is a room message) badges the Rooms tab; web/desktop
 * surfaces the same count on the space-rail tiles instead.
 */
export default function NativeTabsLayout() {
  const { colors } = useTheme();
  const { isWide } = useResponsive();
  const { totalUnread } = useUnread();
  const badge = totalUnread > 0 ? (totalUnread > 99 ? '99+' : String(totalUnread)) : undefined;
  return (
    <NativeTabs
      // On wide native layouts (iPad / foldable) the AppFrame desktop sidebar
      // replaces the bottom bar, so hide it here. Crossing the breakpoint
      // (rotation / multitasking resize) remounts the navigator and resets tab
      // state — acceptable since the whole layout reflows at that point anyway.
      hidden={isWide}
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
        <NativeTabs.Trigger.Label>Chat</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={<NativeTabs.Trigger.VectorIcon family={Feather} name="message-circle" />} />
        <NativeTabs.Trigger.Badge hidden={!badge}>{badge}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="agents">
        <NativeTabs.Trigger.Label>Agents</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={<NativeTabs.Trigger.VectorIcon family={Feather} name="cpu" />} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="work">
        <NativeTabs.Trigger.Label>Work</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={<NativeTabs.Trigger.VectorIcon family={Feather} name="briefcase" />} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
