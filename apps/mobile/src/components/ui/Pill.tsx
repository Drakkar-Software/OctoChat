import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, View } from 'react-native';

import { radii, type Palette } from '@/theme';
import { useTheme } from '@/lib/use-theme';

import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

export type PillTone = 'neutral' | 'accent' | 'success' | 'danger' | 'note';

interface PillProps {
  label: string;
  tone?: PillTone;
  iconName?: IconName;
  mono?: boolean;
  style?: StyleProp<ViewStyle>;
}

function toneColors(c: Palette, tone: PillTone) {
  switch (tone) {
    case 'accent':
      return { bg: c.accentBg, fg: c.accentInk, border: c.accentBorder };
    case 'success':
      return { bg: c.successBg, fg: c.success, border: c.successBorder };
    case 'danger':
      return { bg: c.dangerBg, fg: c.danger, border: c.dangerBorder };
    case 'note':
      return { bg: c.note, fg: c.noteInk, border: 'transparent' };
    default:
      return { bg: c.fill, fg: c.inkSoft, border: c.lineFaint };
  }
}

/** Small labeled chip — tags, "e2ee", status, member counts. */
export function Pill({ label, tone = 'neutral', iconName, mono = false, style }: PillProps) {
  const { colors } = useTheme();
  const t = toneColors(colors, tone);
  return (
    <View style={[styles.pill, { backgroundColor: t.bg, borderColor: t.border }, style]}>
      {iconName ? <Icon name={iconName} size={11} color={t.fg} /> : null}
      <Txt variant="micro" weight="medium" mono={mono} color={t.fg}>
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
});
