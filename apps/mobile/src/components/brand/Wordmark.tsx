import { StyleSheet, Text, View } from 'react-native';

import { fonts } from '@/theme';
import { useTheme } from '@/lib/use-theme';

import { Octopus } from './Octopus';

interface WordmarkProps {
  /** Font size of the wordmark text; the mark scales with it. */
  size?: number;
  /** Override the ink color of "Octo" (the "Chat" half always uses accent). */
  color?: string;
  /** Hide the octopus mark and render text only. */
  hideMark?: boolean;
}

/** "🐙 OctoChat" lockup — display type with the accent-colored "Chat". */
export function Wordmark({ size = 20, color, hideMark = false }: WordmarkProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      {!hideMark && <Octopus size={size + 10} />}
      <Text style={[styles.text, { fontSize: size, color: color ?? colors.ink }]}>
        Octo<Text style={{ color: colors.accent }}>Chat</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    fontFamily: fonts.display,
    letterSpacing: -0.4,
    includeFontPadding: false,
  },
});
