import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { glowShadow, radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';

import { Icon, type IconName } from './Icon';
import { PulseHalo } from './PulseHalo';
import { Txt } from './Txt';

interface EmptyStateProps {
  iconName: IconName;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}

/** Centered icon + copy used for empty tabs and the not-found screen. The icon
 *  disc sits inside a slow bioluminescent halo so empty space feels alive. */
export function EmptyState({ iconName, title, subtitle, children }: EmptyStateProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <PulseHalo size={76} color={colors.accent}>
        <View
          style={[
            styles.icon,
            { backgroundColor: colors.accentBg, borderColor: colors.accentBorder, borderTopColor: colors.hairlineHi },
            glowShadow(colors.glow, 0.2, 14),
          ]}
        >
          <Icon name={iconName} size={28} color={colors.accent} />
        </View>
      </PulseHalo>
      <Txt variant="title" weight="bold" center>
        {title}
      </Txt>
      {subtitle ? (
        <Txt variant="callout" tone="inkSoft" center style={styles.subtitle}>
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
    width: 76,
    height: 76,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtitle: { maxWidth: 320 },
});
