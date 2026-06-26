import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/lib/use-theme';

import { EmptyState } from './EmptyState';

/**
 * Full-screen fallback rendered by `<SunglassesErrorBoundary>` when a render-phase
 * error is caught (see `app/_layout.tsx`). Reuses {@link EmptyState} so the crash
 * screen matches the app's empty/not-found surfaces instead of a blank white view.
 *
 * The boundary's `fallback` is a static `ReactNode` (no reset handler), so this is
 * copy-only — recovery is via relaunch.
 */
export function AppErrorFallback() {
  const { colors } = useTheme();
  return (
    <View style={[styles.wrap, { backgroundColor: colors.canvas }]}>
      <EmptyState
        iconName="alert"
        title="Something went wrong"
        subtitle="The app hit an unexpected error. Please reopen it to continue."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
});
