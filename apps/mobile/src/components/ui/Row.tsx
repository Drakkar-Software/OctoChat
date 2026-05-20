import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';

import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

interface RowProps {
  iconName?: IconName;
  iconColor?: string;
  title: string;
  detail?: string;
  detailMono?: boolean;
  /** Trailing content; defaults to a chevron when `onPress` is set. */
  right?: ReactNode;
  onPress?: () => void;
}

/** Generic settings/list row: leading icon, title + detail, trailing accessory. */
export function Row({ iconName, iconColor, title, detail, detailMono, right, onPress }: RowProps) {
  const { colors } = useTheme();
  const content = (
    <>
      {iconName ? <Icon name={iconName} size={18} color={iconColor ?? colors.accent} /> : null}
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
      <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
        {content}
      </Pressable>
    );
  }
  return <View style={styles.row}>{content}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 4 },
  text: { flex: 1, gap: 2 },
});
