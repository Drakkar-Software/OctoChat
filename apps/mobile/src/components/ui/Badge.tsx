import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/lib/use-theme';

import { Txt } from './Txt';

interface BadgeProps {
  count?: number;
  /** Render as an "@" mention badge (overrides count). */
  mention?: boolean;
  /** `sm` (default, dense rows) keeps the compact 17px disc; `md` (rail, where
   *  room affords more weight) bumps to a more legible 20px / caption type. */
  size?: 'sm' | 'md';
}

/** Unread count / mention indicator used in room rows and the space rail. */
export function Badge({ count = 0, mention = false, size = 'sm' }: BadgeProps) {
  const { colors } = useTheme();
  if (!mention && count <= 0) return null;
  const bg = mention ? colors.mention : colors.unread;
  const sz = size === 'md' ? styles.md : styles.sm;
  return (
    <View style={[styles.badge, sz, { backgroundColor: bg }]}>
      <Txt variant={size === 'md' ? 'footnote' : 'caption'} weight="bold" mono color={colors.onUnread}>
        {mention ? '@' : count > 99 ? '99+' : String(count)}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  sm: { minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 5 },
  md: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6 },
});
