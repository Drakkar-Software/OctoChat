import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing } from '@/theme';
import { relaunchDesktop } from '@/lib/desktop';
import { useAppUpdate } from '@/lib/use-app-update';
import { useDesktopUpdate } from '@/lib/use-desktop-update';
import { useTheme } from '@/lib/use-theme';

import { Button } from './Button';
import { Icon } from './Icon';
import { Txt } from './Txt';

/**
 * Full-width banner that appears at the top of the app when an update is ready
 * to apply. Handles two sources:
 *
 * - **Desktop (Electron):** the custom web-bundle OTA via `useDesktopUpdate()`.
 * - **Mobile (iOS / Android):** an expo-updates bundle via `useAppUpdate()`.
 *
 * Only one source is ever active at a time. Renders nothing when no update is
 * pending and on platforms where neither mechanism fires.
 */
/**
 * @param topInset When the banner sits at the very top of the app (the native
 * top-of-app placement), clear the status bar / notch. Off for the in-shell and
 * above-bottom-bar placements, which already sit below a safe edge.
 */
export function DesktopUpdateBanner({ topInset = false }: { topInset?: boolean }) {
  const desktopVersion = useDesktopUpdate();
  const { updateReady: mobileUpdateReady, applyUpdate } = useAppUpdate();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const pending = !!desktopVersion || mobileUpdateReady;
  const restart = desktopVersion
    ? () => relaunchDesktop()
    : () => void applyUpdate();

  if (!pending) return null;

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.accentBg,
          borderBottomColor: colors.accentBorder,
        },
        topInset && { paddingTop: spacing.xs + insets.top },
      ]}
    >
      <Icon name="chevron-up" size={15} color={colors.accent} />
      <Txt variant="footnote" color={colors.accentInk} style={styles.label}>
        Update ready
      </Txt>
      <Button
        label="Restart"
        variant="primary"
        size="sm"
        onPress={restart}
        style={styles.btn}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
  },
  label: { flex: 1 },
  btn: { marginVertical: -2 },
});
