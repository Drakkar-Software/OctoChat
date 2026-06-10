import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';

import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

interface RowProps {
  iconName?: IconName;
  /** Explicit leading-icon color (wins over `accent`). */
  iconColor?: string;
  /** Punctuate this row's icon with the marine accent — reserve for the one
   *  primary/active row per card so accent stays a signal, not decoration. The
   *  resting default is the muted `inkSoft` glyph. */
  accent?: boolean;
  title: string;
  detail?: string;
  detailMono?: boolean;
  /** Trailing content; defaults to a chevron when `onPress` is set. */
  right?: ReactNode;
  onPress?: () => void;
}

/** Generic settings/list row: leading icon, title + detail, trailing accessory. */
export function Row({ iconName, iconColor, accent, title, detail, detailMono, right, onPress }: RowProps) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  const content = (
    <>
      {iconName ? <Icon name={iconName} size={18} color={iconColor ?? (accent ? colors.accent : colors.inkSoft)} /> : null}
      <View style={styles.text}>
        <Txt variant="callout" weight="semibold">
          {title}
        </Txt>
        {detail ? (
          <Txt variant="caption" tone="inkMuted" mono={detailMono}>
            {detail}
          </Txt>
        ) : null}
      </View>
      {right ?? (onPress ? <Icon name="chev" size={16} color={colors.inkMuted} /> : null)}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        {...hoverProps}
        style={[styles.row, styles.pressable, hovered && { backgroundColor: colors.hover }]}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={styles.row}>{content}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 4 },
  pressable: {
    marginHorizontal: -spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  text: { flex: 1, gap: 2 },
});
