import { Pressable, StyleSheet } from 'react-native';

import { radii, spacing } from '@/theme';
import type { Room } from '@/lib/types';
import { useTheme } from '@/lib/use-theme';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface ChannelRowProps {
  room: Room;
  active?: boolean;
  onPress?: () => void;
}

/** A single room/DM entry in the channel list. */
export function ChannelRow({ room, active = false, onPress }: ChannelRowProps) {
  const { colors } = useTheme();
  const emphasized = (room.unread ?? 0) > 0 || !!room.mention;
  const labelColor = active ? colors.accentInk : emphasized ? colors.ink : colors.inkSoft;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.row, active && { backgroundColor: colors.accentSoft }]}
    >
      {room.kind === 'dm' ? (
        <Avatar label={room.avatar ?? '??'} size={22} />
      ) : (
        <Icon
          name={room.kind === 'private' ? 'lock' : 'hash'}
          size={15}
          color={active ? colors.accent : emphasized ? colors.ink : colors.inkMuted}
        />
      )}
      <Txt
        variant="subhead"
        weight={emphasized || active ? 'semibold' : 'regular'}
        color={labelColor}
        numberOfLines={1}
        style={styles.name}
      >
        {room.name}
      </Txt>
      {room.mention ? <Badge mention /> : room.unread ? <Badge count={room.unread} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
  },
  name: { flex: 1 },
});
