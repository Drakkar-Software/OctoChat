import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { layout, shadows, spacing } from '@/theme';
import { useProfile } from '@/lib/profile-context';
import { useTheme } from '@/lib/use-theme';
import { Avatar } from '@/components/ui/Avatar';

import { SpaceSettingsButton } from './SpaceSettingsButton';
import { SpaceSwitcher } from './SpaceSwitcher';

/**
 * The shared header for the three mobile mode tabs (Chat · Agents · Work): the
 * self-contained {@link SpaceSwitcher} on the left (tap → bottom sheet to change
 * space) and a profile action on the right. Self-contained — each tab page just
 * drops it in. Mobile-only; the desktop shell uses the persistent sidebar instead.
 */
export function SpaceTabHeader() {
  const { colors } = useTheme();
  const { profile } = useProfile();
  const meLabel = (profile?.name ?? '··').slice(0, 2).toUpperCase();

  return (
    // Lit-from-above top edge (hairlineHi) + a soft drop shadow give the header
    // marine depth so it reads as a raised surface, not a flat paper strip.
    <View
      style={[
        styles.bar,
        shadows.sm,
        { backgroundColor: colors.paper, borderBottomColor: colors.lineSoft, borderTopColor: colors.hairlineHi },
      ]}
    >
      <SpaceSwitcher />
      <SpaceSettingsButton />
      <Pressable accessibilityRole="button" accessibilityLabel="Your profile" onPress={() => router.push('/you')} hitSlop={6}>
        <Avatar label={meLabel} image={profile?.avatar} size={30} />
      </Pressable>
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
});
