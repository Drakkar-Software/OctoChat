import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { fonts } from '@/theme';
import { useResponsive } from '@/lib/use-responsive';
import { useTheme } from '@/lib/use-theme';
import { tabBadgeLabel, useUnread } from '@/lib/unread-context';
import { useTotalDmUnread } from '@/lib/use-dms';
import { useActiveAgentUnread } from '@/lib/use-agent-unread';

/**
 * Native (iOS / Android) bottom tabs. Renders the real platform tab bar —
 * SwiftUI `UITabBar` (liquid glass on iOS 26) / Material 3 bottom navigation —
 * via Expo Router's `NativeTabs`. The web/PWA build keeps the JS `Tabs`
 * renderer in `_layout.tsx` (Metro resolves this `.native.tsx` variant only on
 * native), which is also where the desktop sidebar swap and the OTA update
 * banner live.
 *
 * The tabs are the workspace modes (Chat · Agents · DMs) plus global Search,
 * which carries `role="search"` so iOS 26 floats it to the bottom-right as the
 * native search tab. `threads` and `you` are NOT tabs: they live at the app root
 * and are reached via `router.push(...)` from the Chat tab / its header — native
 * tabs have no `href: null` equivalent (a `hidden` trigger is non-navigable).
 *
 * Icons mostly follow the app's Feather line-art vocabulary (via `VectorIcon`)
 * so the tab glyphs match the rest of the UI — Agents is the Ionicons sparkle,
 * mirroring the web `Icon` set; the native feel comes from the bar itself.
 * `totalUnread` (every unread message across rooms — thread replies
 * included, since a reply is a room message) badges the Rooms tab; web/desktop
 * surfaces the same count on the space-rail tiles instead. The DMs and Agents
 * tabs carry their own badges too: DMs sums every DM room's unread (global),
 * while Agents sums the ACTIVE space's automated rooms — matching that tab's own
 * active-space scope. All three format through `tabBadgeLabel` (hide at zero,
 * cap at "99+").
 */
export default function NativeTabsLayout() {
  const { colors } = useTheme();
  const { isWide } = useResponsive();
  const { totalUnread } = useUnread();
  const badge = tabBadgeLabel(totalUnread);
  const agentBadge = tabBadgeLabel(useActiveAgentUnread());
  const dmBadge = tabBadgeLabel(useTotalDmUnread());
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
        <NativeTabs.Trigger.Icon src={<NativeTabs.Trigger.VectorIcon family={Ionicons} name="sparkles-outline" />} />
        <NativeTabs.Trigger.Badge hidden={!agentBadge}>{agentBadge}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="dms">
        <NativeTabs.Trigger.Label>DMs</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={<NativeTabs.Trigger.VectorIcon family={Feather} name="message-square" />} />
        <NativeTabs.Trigger.Badge hidden={!dmBadge}>{dmBadge}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      {/* `role="search"` makes this the platform search tab: on iOS 26 it floats
          to the bottom-right as a dedicated search affordance rather than sitting
          inline with the other tabs. Older iOS and Android have no equivalent, so
          it gracefully degrades to a normal tab (hence the Icon stays for them). */}
      <NativeTabs.Trigger name="search" role="search">
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon src={<NativeTabs.Trigger.VectorIcon family={Feather} name="search" />} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
