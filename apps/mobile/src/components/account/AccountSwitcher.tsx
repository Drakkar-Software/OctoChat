import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useSession } from '@/lib/session-context';
import { useAvatars } from '@/lib/use-pseudos';
import { useTheme } from '@/lib/use-theme';
import { Avatar } from '@/components/ui/Avatar';
import { Divider } from '@/components/ui/Divider';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface AccountSwitcherProps {
  /** Dismiss the surrounding popover after an action (no-op for an inline mount). */
  onRequestClose?: () => void;
  /** Optional "Profile & settings" entry — used by the desktop rail popover, whose
   *  foot avatar is otherwise the only path to the profile screen. */
  onViewProfile?: () => void;
}

/**
 * The account list + add/logout actions, shared by the desktop rail popover and the
 * mobile "You" tab card. Reads the held accounts from the session and drives switch /
 * add / logout — UI only, no persistence logic of its own.
 */
export function AccountSwitcher({ onRequestClose, onViewProfile }: AccountSwitcherProps) {
  // useAvatars reads a module-level cache the React Compiler can't track; without
  // opting out, the row JSX memoizes stale here because the accessor's identity
  // stays stable while the held-account id set does too. See use-pseudos.ts.
  'use no memo';
  const { colors } = useTheme();
  const { accounts, activeUserId, switchAccount, logoutAccount } = useSession();
  // Each held account's public avatar (its own per-identity profile), resolved
  // through the shared profile cache — falls back to the monogram until it lands.
  const avatar = useAvatars(accounts.map((a) => a.userId).filter(Boolean));

  const onSwitch = (userId: string) => {
    onRequestClose?.();
    if (userId !== activeUserId) void switchAccount(userId);
  };

  const onAdd = () => {
    onRequestClose?.();
    // Dedicated in-app flow that appends to the unlocked vault — not the onboarding
    // welcome front-door (which is for the FIRST account / sign-in).
    router.push('/account/add');
  };

  const onLogout = () => {
    onRequestClose?.();
    const wasLast = accounts.length <= 1;
    void logoutAccount(activeUserId ?? '').then(() => {
      if (wasLast) router.replace('/(onboarding)/welcome');
    });
  };

  return (
    <View style={styles.menu}>
      {accounts.map((a) => {
        const active = a.userId === activeUserId;
        return (
          <Pressable
            key={a.userId || a.name}
            accessibilityRole="button"
            accessibilityLabel={active ? `${a.name} (current)` : `Switch to ${a.name}`}
            onPress={() => onSwitch(a.userId)}
            style={[styles.account, active && { backgroundColor: colors.accentBg }]}
          >
            <Avatar label={a.name.slice(0, 2).toUpperCase()} image={avatar(a.userId)} size={34} ring={active} />
            <View style={styles.accountText}>
              <Txt variant="callout" weight="semibold" numberOfLines={1}>
                {a.name}
              </Txt>
              {a.fingerprint ? (
                <Txt variant="micro" mono tone="inkMuted" numberOfLines={1}>
                  {a.fingerprint}
                </Txt>
              ) : null}
            </View>
            {active ? <Icon name="check" size={16} color={colors.accent} /> : null}
          </Pressable>
        );
      })}

      <Divider style={styles.divider} />

      {onViewProfile ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Profile and settings"
          onPress={() => {
            onRequestClose?.();
            onViewProfile();
          }}
          style={styles.action}
        >
          <Icon name="gear" size={18} color={colors.inkSoft} />
          <Txt variant="callout" weight="semibold">
            Profile &amp; settings
          </Txt>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add account"
        onPress={onAdd}
        style={styles.action}
      >
        <Icon name="plus" size={18} color={colors.accent} />
        <Txt variant="callout" weight="semibold" tone="accent">
          Add account
        </Txt>
      </Pressable>
      {activeUserId ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log out this account"
          onPress={onLogout}
          style={styles.action}
        >
          <Icon name="logout" size={18} color={colors.danger} />
          <Txt variant="callout" weight="semibold" tone="danger">
            Log out this account
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  menu: { gap: spacing.xs },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radii.md,
  },
  accountText: { flex: 1, gap: 1 },
  divider: { marginVertical: spacing.xs },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
});
