import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useInShell } from '@/lib/use-responsive';
import { useTheme } from '@/lib/use-theme';
import { DesktopNav } from '@/components/chat/DesktopNav';

/**
 * App-wide layout shell. On wide viewports (web/tablet) it frames the routed
 * content with the persistent desktop navigation; on phones — and on the
 * onboarding stack or before sign-in — it renders the routes untouched so the
 * mobile bottom-tab layout stands on its own.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const inShell = useInShell();

  if (!inShell) return <>{children}</>;

  return (
    <View style={[styles.row, { backgroundColor: colors.canvas }]}>
      <DesktopNav />
      <View style={styles.main}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  main: { flex: 1, minWidth: 0 },
});
