import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useInShell } from '@/lib/use-responsive';
import { useTheme } from '@/lib/use-theme';
import { DesktopNav } from '@/components/chat/DesktopNav';
import { DesktopUpdateBanner } from './DesktopUpdateBanner';

/**
 * App-wide layout shell. On wide viewports (web/tablet) it frames the routed
 * content with the persistent desktop navigation; on phones — and on the
 * onboarding stack or before sign-in — it renders the routes untouched so the
 * mobile bottom-tab layout stands on its own.
 *
 * The DesktopUpdateBanner sits at the top of both layouts so it is visible
 * regardless of which route is active.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const inShell = useInShell();

  return (
    <View style={styles.col}>
      <DesktopUpdateBanner />
      {inShell ? (
        <View style={[styles.row, { backgroundColor: colors.canvas }]}>
          <DesktopNav />
          <View style={styles.main}>{children}</View>
        </View>
      ) : (
        <View style={styles.fill}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  col: { flex: 1 },
  fill: { flex: 1 },
  row: { flex: 1, flexDirection: 'row' },
  main: { flex: 1, minWidth: 0 },
});
