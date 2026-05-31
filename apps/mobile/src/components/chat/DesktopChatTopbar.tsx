import { StyleSheet, View } from 'react-native';

import { layout, spacing } from '@/theme';
import type { RoomKind } from '@/lib/types';
import { useTheme } from '@/lib/use-theme';
import { useDms } from '@/lib/use-dms';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';

interface DesktopChatTopbarProps {
  name: string;
  kind?: RoomKind;
  /** The room's space id — used to resolve a DM peer's avatar (image + monogram). */
  spaceId?: string;
  onSearch?: () => void;
  onDetails?: () => void;
}

/**
 * The 52px toolbar above the main pane on desktop: the room's kind glyph + name
 * on the left, search + details on the right. Replaces the centered mobile
 * {@link AppBar} when the app is in shell mode — so it must carry the same
 * right-hand affordances (the info button routes to space details, or an
 * automated room's settings sheet).
 *
 * A DM header shows the PEER's real avatar (image with monogram fallback) — the
 * same {@link Avatar} the chat messages use — instead of a generic people glyph,
 * resolved from the shared DM list (same profile cache, no extra request).
 */
export function DesktopChatTopbar({ name, kind = 'channel', spaceId, onSearch, onDetails }: DesktopChatTopbarProps) {
  const { colors } = useTheme();
  const dms = useDms();
  const dm = kind === 'dm' ? dms.find((d) => d.spaceId === spaceId) : undefined;
  return (
    <View style={[styles.bar, { height: layout.desktopTopbarHeight, backgroundColor: colors.paper, borderBottomColor: colors.lineSoft }]}>
      {kind === 'dm' ? (
        <Avatar label={dm?.initials ?? name.slice(0, 2).toUpperCase()} image={dm?.image} size={24} />
      ) : (
        <Icon
          name={
            kind === 'automated'
              ? 'zap'
              : kind === 'stream'
              ? 'stream'
              : kind === 'private'
              ? 'lock'
              : 'hash'
          }
          size={16}
          color={colors.inkSoft}
        />
      )}
      <Txt variant="subhead" weight="semibold" numberOfLines={1} style={styles.name}>
        {name}
      </Txt>
      <IconButton name="search" size={16} onPress={onSearch} accessibilityLabel="Search in room" />
      <IconButton name="info" size={16} onPress={onDetails} accessibilityLabel="Space details" />
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
