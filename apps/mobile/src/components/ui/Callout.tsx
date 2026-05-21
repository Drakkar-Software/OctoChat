import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { radii, spacing, type Palette } from '@/theme';
import { useTheme } from '@/lib/use-theme';

import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

export type CalloutTone = 'accent' | 'danger' | 'warning' | 'info';

interface CalloutProps {
  tone?: CalloutTone;
  iconName?: IconName;
  title?: string;
  children: ReactNode;
}

function calloutStyle(c: Palette, tone: CalloutTone) {
  switch (tone) {
    case 'accent':
      return { bg: c.accentBg, border: c.accentBorder, icon: c.accent, fg: c.accentInk, full: true };
    case 'danger':
      return { bg: c.dangerBg, border: c.danger, icon: c.danger, fg: c.inkSoft, full: false };
    case 'warning':
      return { bg: c.warningBg, border: c.warning, icon: c.warning, fg: c.inkSoft, full: false };
    default:
      return { bg: c.surface, border: c.lineSoft, icon: c.inkSoft, fg: c.inkSoft, full: true };
  }
}

/**
 * Inline informational / security note. `accent` & `info` render a full
 * border; `danger` & `warning` use a colored left rule (the seed-backup style).
 */
export function Callout({ tone = 'info', iconName, title, children }: CalloutProps) {
  const { colors } = useTheme();
  const s = calloutStyle(colors, tone);
  return (
    <View
      style={[
        styles.callout,
        s.full
          ? { backgroundColor: s.bg, borderColor: s.border, borderTopColor: colors.hairlineHi, borderWidth: 1 }
          : { backgroundColor: s.bg, borderLeftColor: s.border, borderLeftWidth: 3 },
      ]}
    >
      {iconName ? <Icon name={iconName} size={18} color={s.icon} /> : null}
      <View style={styles.body}>
        {title ? (
          <Txt variant="footnote" weight="bold" color={s.icon}>
            {title}
          </Txt>
        ) : null}
        <Txt variant="footnote" color={s.fg}>
          {children}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  callout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
  },
  body: { flex: 1, gap: 2 },
});
