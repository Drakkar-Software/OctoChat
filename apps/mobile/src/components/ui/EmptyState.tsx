import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';

import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

interface EmptyStateProps {
  iconName: IconName;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}

/** Centered icon + copy used for empty tabs and the not-found screen. */
export function EmptyState({ iconName, title, subtitle, children }: EmptyStateProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={[styles.icon, { backgroundColor: colors.accentBg, borderColor: colors.accentBorder }]}>
        <Icon name={iconName} size={28} color={colors.accent} />
      </View>
      <Txt variant="title" weight="bold" center>
        {title}
      </Txt>
      {subtitle ? (
        <Txt variant="callout" tone="inkSoft" center>
          {subtitle}
        </Txt>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  icon: {
    width: 72,
    height: 72,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
});
