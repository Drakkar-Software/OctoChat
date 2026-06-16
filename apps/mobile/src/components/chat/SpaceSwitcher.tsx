import { Platform, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { radii } from '@/theme';
import { DM_HOME_ID, DM_HOME_NAME, isDmHomeId } from '@/lib/dm-home';
import { tapFeedback } from '@/lib/haptics';
import { useTotalDmUnread } from '@/lib/use-dms';
import { useSpaces } from '@/lib/use-spaces';
import { useTheme } from '@/lib/use-theme';
import { SpaceSwitcher as PkgSpaceSwitcher } from '@drakkar.software/octospaces-ui';
import type { SwitcherIconName, SwitcherSpace } from '@drakkar.software/octospaces-ui';
import { AccountSwitcher } from '@/components/account/AccountSwitcher';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';

// ── Icon mapping ──────────────────────────────────────────────────────────────

const SWITCHER_ICON: Record<SwitcherIconName, IconName> = {
  'chevron-down': 'chevron-down',
  'chevron-right': 'chevron-right',
  check: 'check',
  plus: 'plus',
  gear: 'gear',
  globe: 'globe',
};

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Mobile workspace-identity trigger — the phone-only replacement for the always-on
 * {@link DesktopSpacesRail}. Renders the active space avatar + name + chevron (same
 * shape as OctoVault's appbar switcher); tapping opens a bottom sheet with:
 *
 * - Space rows (≤5 shown inline; "See all" → /spaces when there are more)
 * - Per-row unread badges
 * - "Join or create a space" and "Browse spaces" actions
 * - "Space settings" for the active space
 * - Account section (switch / add / profile / logout) in the footer
 *
 * Self-contained — reads its own data via hooks so call sites need no props.
 * Mobile-only; the desktop shell uses the persistent {@link DesktopSpacesRail}.
 */
export function SpaceSwitcher() {
  const { spaces, activeId, setActiveId, loading } = useSpaces();
  const dmUnread = useTotalDmUnread();
  const isDmHome = isDmHomeId(activeId);
  const active = isDmHome ? null : (spaces.find((s) => s.id === activeId) ?? spaces[0] ?? null);

  // Aggregate dot: other spaces (not the active one) have unread, or DMs do when
  // not on DM-home — the single trigger can't show every badge like the rail did.
  const otherUnread =
    spaces.some((s) => s.id !== activeId && (s.unread ?? 0) > 0) ||
    (!isDmHome && dmUnread > 0);

  // DM-home is a bottom-tab on native so only add the synthetic row on web.
  const switcherSpaces: SwitcherSpace[] = [
    ...(Platform.OS === 'web'
      ? [{ id: DM_HOME_ID, name: DM_HOME_NAME, short: '', unread: dmUnread }]
      : []),
    ...spaces.map((s) => ({
      id: s.id,
      name: s.name,
      short: s.short,
      image: s.image,
      unread: s.unread,
    })),
  ];

  return (
    <PkgSpaceSwitcher
      spaces={switcherSpaces}
      activeId={activeId}
      onSelect={(id) => {
        tapFeedback();
        setActiveId(id);
      }}
      onAdd={() => router.push('/join')}
      onBrowse={() => router.push('/spaces/explore')}
      onSettings={
        active
          ? () =>
              router.push({
                pathname: '/space/[id]',
                params: { id: active.id, name: active.name },
              })
          : undefined
      }
      maxVisible={5}
      onSeeAll={() => router.push('/spaces')}
      seeAllLabel="See all spaces"
      variant="appbar"
      emptyLabel="Create a space"
      renderTriggerAvatar={(space, size) => {
        if (!space) return null;
        if (space.id === DM_HOME_ID) {
          // DM-home tile uses the same people icon as the old trigger.
          return (
            <Icon name="people" size={size - 8} color={undefined} />
          );
        }
        return <Avatar label={space.short ?? space.name.slice(0, 2)} image={space.image} size={size} />;
      }}
      renderTriggerBadge={otherUnread ? () => <OtherUnreadDot /> : undefined}
      renderSpaceAvatar={(space, size) => {
        if (space.id === DM_HOME_ID) {
          return <Icon name="people" size={size - 8} color={undefined} />;
        }
        return <Avatar label={space.short ?? space.name.slice(0, 2)} image={space.image} size={size} />;
      }}
      renderIcon={(name, sz, color) => <Icon name={SWITCHER_ICON[name]} size={sz} color={color} />}
      renderBadge={(count) => <Badge count={count} size="sm" />}
      renderContainer={({ isOpen, onClose, children }) => (
        <BottomSheet visible={isOpen} onClose={onClose} title="Switch space">
          {children}
        </BottomSheet>
      )}
      footerSlot={(close) => (
        <AccountSwitcher
          onRequestClose={close}
          onViewProfile={() => {
            close();
            router.push('/you');
          }}
        />
      )}
    />
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Small dot overlaid top-right of the trigger avatar when other spaces or DMs
 * have unread activity — reproduces the old header-pill attention indicator.
 */
function OtherUnreadDot() {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.dot,
        { backgroundColor: colors.unread, borderColor: colors.paper },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: { width: 10, height: 10, borderRadius: radii.pill, borderWidth: 2 },
});
