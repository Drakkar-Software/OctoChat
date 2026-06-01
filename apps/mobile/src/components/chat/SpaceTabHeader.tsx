import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { layout, spacing } from '@/theme';
import { DM_HOME_ID, isDmHomeId } from '@/lib/dm-home';
import { useProfile } from '@/lib/profile-context';
import { useTheme } from '@/lib/use-theme';
import { useSpaces } from '@/lib/use-spaces';
import { useTotalDmUnread } from '@/lib/use-dms';
import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';

import { SpaceSwitcher } from './SpaceSwitcher';

/**
 * The shared header for the three mobile mode tabs (Chat · Agents · Work): a
 * compact {@link SpaceSwitcher} on the left (tap to change space), and global
 * search + profile actions on the right. Self-contained — it reads the spaces /
 * profile / DM state and wires its own navigation, so each tab page just drops
 * it in. Mobile-only; the desktop shell uses its persistent sidebar instead.
 */
export function SpaceTabHeader() {
  const { colors } = useTheme();
  const { spaces, activeId, setActiveId } = useSpaces();
  const { profile } = useProfile();
  const dmUnread = useTotalDmUnread();
  const isDmHome = isDmHomeId(activeId);
  const space = isDmHome ? undefined : spaces.find((s) => s.id === activeId) ?? spaces[0];
  const meLabel = (profile?.name ?? '··').slice(0, 2).toUpperCase();

  return (
    <View style={[styles.bar, { backgroundColor: colors.paper, borderBottomColor: colors.lineSoft }]}>
      <SpaceSwitcher
        space={space}
        isDmHome={isDmHome}
        spaces={spaces}
        activeId={activeId ?? DM_HOME_ID}
        dmUnread={dmUnread}
        onSelectSpace={setActiveId}
        onSelectDms={() => setActiveId(DM_HOME_ID)}
        onAddSpace={() => router.push('/join')}
      />
      <IconButton name="search" onPress={() => router.push('/search')} accessibilityLabel="Search" />
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
    borderBottomWidth: 1,
  },
});
