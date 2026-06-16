import { StyleSheet, View } from 'react-native';

import { layout, shadows, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';

import { CreateRoomButton } from './CreateRoomButton';
import { SpaceSwitcher } from './SpaceSwitcher';

/**
 * The shared web header for the three mobile-mode tabs (Chat · Agents · Work):
 * the {@link SpaceSwitcher} centered as the title and an owner-gated
 * {@link CreateRoomButton} on the right. Self-contained — each tab page just
 * drops it in. Mobile/web-only; the desktop shell uses the persistent sidebar.
 *
 * Mirrors the native nav-stack header from {@link SpaceStackLayout}: centered
 * switcher + "+" on the right. The avatar (profile) is reachable from the
 * switcher's account-section footer.
 */
export function SpaceTabHeader() {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.bar,
        shadows.sm,
        { backgroundColor: colors.paper, borderBottomColor: colors.lineSoft, borderTopColor: colors.hairlineHi },
      ]}
    >
      {/* Left spacer — symmetrical with the right side so the switcher centers. */}
      <View style={styles.side} />
      <SpaceSwitcher />
      <View style={[styles.side, styles.right]}>
        <CreateRoomButton />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: layout.headerMinHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 1,
  },
  side: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 32 },
  right: { justifyContent: 'flex-end' },
});
