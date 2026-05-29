import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, View } from 'react-native';

import { paperBorder, radii, shadows, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';

import { Txt } from './Txt';

interface CardProps {
  title?: string;
  children: ReactNode;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Paper section with an optional uppercase mono title. */
export function Card({ title, children, padded = true, style }: CardProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.card,
        paperBorder(colors),
        padded && styles.padded,
        shadows.sm,
        style,
      ]}
    >
      {title ? (
        <Txt variant="caption" weight="semibold" mono uppercase tone="inkSoft">
          {title}
        </Txt>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.card,
    borderWidth: 1,
    gap: spacing.md,
  },
  padded: { padding: spacing.lg },
});
