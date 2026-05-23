import { StyleSheet, View } from 'react-native';

import { layout, spacing } from '@/theme';
import type { RoomKind } from '@/lib/types';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';

interface DesktopChatTopbarProps {
  name: string;
  kind?: RoomKind;
  onSearch?: () => void;
}

/**
 * The 52px toolbar above the main pane on desktop: the room's kind glyph + name
 * on the left, search on the right. Replaces the centered mobile {@link AppBar}
 * when the app is in shell mode.
 */
export function DesktopChatTopbar({ name, kind = 'channel', onSearch }: DesktopChatTopbarProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.bar, { height: layout.desktopTopbarHeight, backgroundColor: colors.paper, borderBottomColor: colors.lineSoft }]}>
      <Icon name={kind === 'dm' ? 'people' : kind === 'private' ? 'lock' : 'hash'} size={16} color={colors.inkSoft} />
      <Txt variant="subhead" weight="semibold" numberOfLines={1} style={styles.name}>
        {name}
      </Txt>
      <IconButton name="search" size={16} onPress={onSearch} accessibilityLabel="Search in room" />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
  },
  name: { flex: 1, minWidth: 0 },
});
