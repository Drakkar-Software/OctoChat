import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Txt } from '@/components/ui/Txt';

interface OwnerConfigPanelProps {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
}

/** Recessed owner-only config well (title + helper + body) — the shared chrome
 *  for the stream-bot and webhook panels, which previously duplicated it. */
export function OwnerConfigPanel({ title, subtitle, children }: OwnerConfigPanelProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.wrap, { borderColor: colors.lineSoft, backgroundColor: colors.paperAlt }]}>
      <View style={styles.head}>
        <Txt variant="footnote" weight="semibold">
          {title}
        </Txt>
        <Txt variant="caption" tone="inkMuted">
          {subtitle}
        </Txt>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
    margin: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radii.lg,
  },
  head: { gap: 2 },
});
