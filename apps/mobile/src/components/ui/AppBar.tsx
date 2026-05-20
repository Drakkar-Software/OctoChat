import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { layout, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';

import { IconButton } from './IconButton';
import { Txt } from './Txt';

interface AppBarProps {
  title: string;
  /** String renders as a centered caption; node lets you compose icons. */
  subtitle?: ReactNode;
  /** Convenience: renders a back chevron on the left. */
  onBack?: () => void;
  /** Override the left region entirely. */
  left?: ReactNode;
  /** Right-aligned actions. */
  right?: ReactNode;
}

/**
 * iOS-style header: symmetric flexible side regions with a centered title +
 * optional sub-line. Used across every pushed screen.
 */
export function AppBar({ title, subtitle, onBack, left, right }: AppBarProps) {
  const { colors } = useTheme();
  const leftNode =
    left ??
    (onBack ? (
      <IconButton name="arrow-l" size={20} color={colors.ink} onPress={onBack} accessibilityLabel="Back" />
    ) : null);

  return (
    <View style={[styles.bar, { backgroundColor: colors.paper, borderBottomColor: colors.lineSoft }]}>
      <View style={styles.side}>{leftNode}</View>
      <View style={styles.center}>
        <Txt variant="heading" weight="semibold" numberOfLines={1}>
          {title}
        </Txt>
        {subtitle != null ? (
          typeof subtitle === 'string' ? (
            <Txt variant="caption" tone="inkMuted" numberOfLines={1}>
              {subtitle}
            </Txt>
          ) : (
            <View style={styles.subRow}>{subtitle}</View>
          )
        ) : null}
      </View>
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.headerMinHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
  },
  side: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.lg, minWidth: 32 },
  center: { flexShrink: 1, alignItems: 'center', paddingHorizontal: 6, gap: 2 },
  right: { justifyContent: 'flex-end' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
