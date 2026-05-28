import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { isMacDesktop } from '@/lib/desktop';
import { useInShell } from '@/lib/use-responsive';
import { useSession } from '@/lib/session-context';
import { useTheme } from '@/lib/use-theme';
import { layout } from '@/theme';
import { DesktopNav } from '@/components/chat/DesktopNav';
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
      {inShell ? <DesktopUpdateBanner /> : null}
      {inShell ? (
        <View style={[styles.row, { backgroundColor: colors.canvas }]}>
          <DesktopNav />
          <View style={styles.main}>{children}</View>
        </View>
      ) : (
        <View style={styles.fill}>{children}</View>
      )}
      {status === 'switching' ? (
        <View style={[StyleSheet.absoluteFill, styles.switching, { backgroundColor: colors.scrim }]}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}
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
