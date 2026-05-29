import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/lib/use-theme';

import { Txt } from './Txt';

interface BadgeProps {
  count?: number;
  /** Render as an "@" mention badge (overrides count). */
  mention?: boolean;
}

/** Unread count / mention indicator used in room rows and the space rail. */
export function Badge({ count = 0, mention = false }: BadgeProps) {
  const { colors } = useTheme();
  if (!mention && count <= 0) return null;
  const bg = mention ? colors.mention : colors.unread;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Txt variant="micro" weight="bold" mono color={colors.onUnread}>
        {mention ? '@' : count > 99 ? '99+' : String(count)}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
