import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { authorFor, hhmm, type StoredMsg } from '@/lib/message-view';
import type { Room } from '@/lib/types';
import { useHover } from '@/lib/use-hover';
import { useAvatars, usePseudos } from '@/lib/use-pseudos';
import { useTheme } from '@/lib/use-theme';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

/** A message preview row used in Search results and the Activity feed. When
 *  `unread` is set the row carries an accent rail + wash to read as a new item. */
export function MessageResult({
  room,
  msg,
  currentUserId,
  unread = false,
  onPress,
}: {
  room: Room;
  msg: StoredMsg;
  currentUserId: string;
  unread?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  const pseudo = usePseudos([msg.authorId]);
  const avatar = useAvatars([msg.authorId]);
  const author = authorFor(msg.authorId, currentUserId, pseudo(msg.authorId), avatar(msg.authorId));
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      {...hoverProps}
      style={[
        styles.row,
        {
          borderColor: hovered ? colors.accentBorder : unread ? colors.accentBorder : colors.lineFaint,
          borderTopColor: hovered ? colors.accentBorder : unread ? colors.accentBorder : colors.hairlineHi,
          backgroundColor: unread ? colors.accentSoft : hovered ? colors.paperAlt : colors.paper,
        },
      ]}
    >
      {unread ? <View style={[styles.rail, { backgroundColor: colors.accent }]} /> : null}
      <Avatar label={author.initials} image={author.avatar} size={32} />
      <View style={styles.body}>
        <View style={styles.head}>
          <Icon name={room.kind === 'private' ? 'lock' : 'hash'} size={11} color={colors.inkMuted} />
          <Txt variant="caption" weight="semibold" tone="inkSoft">
            {room.name}
          </Txt>
          <View style={styles.spacer} />
          <Txt variant="micro" mono tone="inkMuted">
            {hhmm(msg.ts)}
          </Txt>
        </View>
        <Txt variant="footnote" weight="semibold">
          {author.name}
        </Txt>
        <Txt variant="footnote" tone="inkSoft" numberOfLines={2}>
          {msg.text ?? '(attachment)'}
        </Txt>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
  },
  rail: {
    position: 'absolute',
    left: 0,
    top: spacing.sm,
    bottom: spacing.sm,
    width: 3,
    borderTopRightRadius: radii.xs,
    borderBottomRightRadius: radii.xs,
  },
  body: { flex: 1, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  spacer: { flex: 1 },
});
