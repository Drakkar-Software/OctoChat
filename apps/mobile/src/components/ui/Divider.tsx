import type { StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';

import { useTheme } from '@/lib/use-theme';

interface DividerProps {
  color?: string;
  style?: StyleProp<ViewStyle>;
}

/** 1px horizontal rule using the faint line token. */
export function Divider({ color, style }: DividerProps) {
  const { colors } = useTheme();
  return <View style={[{ height: 1, backgroundColor: color ?? colors.lineFaint }, style]} />;
}
