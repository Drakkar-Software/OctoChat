import type { StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';

import { useTheme } from '@/lib/use-theme';

interface DividerProps {
  /** Explicit override — wins over `tone`. */
  color?: string;
  /** `line` (default) is the solid on-paper hairline; `rule`/`ruleSoft` are the
   *  translucent tokens that dissolve into the depth gradient over canvas. */
  tone?: 'line' | 'rule' | 'ruleSoft';
  style?: StyleProp<ViewStyle>;
}

/** 1px horizontal rule — solid lineFaint by default, or a translucent rule over
 *  the subaqua gradient. */
export function Divider({ color, tone = 'line', style }: DividerProps) {
  const { colors } = useTheme();
  const toneColor = tone === 'rule' ? colors.rule : tone === 'ruleSoft' ? colors.ruleSoft : colors.lineFaint;
  return <View style={[{ height: 1, backgroundColor: color ?? toneColor }, style]} />;
}
