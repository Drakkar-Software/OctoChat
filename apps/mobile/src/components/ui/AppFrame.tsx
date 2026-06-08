import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { isMacDesktop } from '@/lib/desktop';
import { useInShell } from '@/lib/use-responsive';
import { useSession } from '@/lib/session-context';
import { useTheme } from '@/lib/use-theme';
import { useUpdateState } from '@/lib/use-update-state';
import { layout } from '@/theme';
import { DesktopNav } from '@/components/chat/DesktopNav';
import { AppLockGate } from './AppLockGate';
import { DesktopUpdateBanner } from './DesktopUpdateBanner';

/**
 * App-wide layout shell. On wide viewports (web/tablet) it frames the routed
 * content with the persistent desktop navigation; on phones — and on the
 * onboarding stack or before sign-in — it renders the routes untouched so the
 * mobile bottom-tab layout stands on its own.
 *
 * On wide layouts the DesktopUpdateBanner sits at the top so it stays visible
 * over the persistent sidebar; on phones the tabs layout renders it just above
 * the bottom tab bar instead (see `(tabs)/_layout.tsx`).
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const inShell = useInShell();
  const { status } = useSession();
  const insets = useSafeAreaInsets();
  const { pending: updatePending } = useUpdateState();

  // On native the banner sits at the very top and clears the notch itself, so the
  // screens below must NOT reserve the top inset again. Zero it for the subtree
  // below the banner while it's showing: every top inset down there — the native
  // nav header, StackScreen's `nativeHeaderPadTop`, and the (now hook-based) top
  // SafeAreaViews in StackScreen/Screen — keys off this same `useSafeAreaInsets()`
  // value, so they all collapse together and the empty band disappears. (Web puts
  // the banner above the bottom bar, so no top inset is consumed there.)
  const eatTopInset = Platform.OS !== 'web' && updatePending;

  const body = inShell ? (
    <View style={[styles.row, { backgroundColor: colors.canvas }]}>
      <DesktopNav />
      <View style={styles.main}>{children}</View>
    </View>
  ) : (
    <View style={styles.fill}>{children}</View>
  );

  return (
    <View style={styles.col}>
      {isMacDesktop() ? (
        // Draggable strip clearing the macOS traffic lights (hiddenInset). The
        // WebkitAppRegion key is forwarded to inline CSS by react-native-web.
        <View
          style={[
            styles.titlebar,
            { backgroundColor: colors.canvas },
            { WebkitAppRegion: 'drag' } as object,
          ]}
        />
      ) : null}
      {/* Render the update banner at the top of the app in the desktop shell
          (web/tablet) and on every native screen — NativeTabs can't host a
          custom view above the tab bar, so native loses the above-bar slot (see
          (tabs)/_layout.native.tsx). On native the banner is the topmost view,
          so it clears the status bar / notch. On mobile web the (tabs) layout
          renders it above the bottom bar instead, so skip it here. */}
      {inShell || Platform.OS !== 'web' ? (
        <DesktopUpdateBanner topInset={Platform.OS !== 'web'} />
      ) : null}
      {eatTopInset ? (
        <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
          {body}
        </SafeAreaInsetsContext.Provider>
      ) : (
        body
      )}
      {status === 'switching' ? (
        <View style={[StyleSheet.absoluteFill, styles.switching, { backgroundColor: colors.scrim }]}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}
      {/* Topmost child so the native biometric lock covers everything above (renders
          nothing on web / when the lock is off). */}
      <AppLockGate />
    </View>
  );
}

const styles = StyleSheet.create({
  col: { flex: 1 },
  titlebar: { height: layout.desktopTitlebarInset },
  fill: { flex: 1 },
  row: { flex: 1, flexDirection: 'row' },
  main: { flex: 1, minWidth: 0 },
  switching: { alignItems: 'center', justifyContent: 'center' },
});
