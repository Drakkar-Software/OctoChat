import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { displayTracking, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';
import { Txt } from '@/components/ui/Txt';

const LOGO = require('../../../assets/images/logo.png') as number;

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
  // Both spans must share fontSize AND lineHeight — Txt always applies the variant's
  // own line height, so a bare nested <Txt> would shrink "Chat" to body size. Keep a
  // little leading (~1.1×, the house display ratio) so the bold glyphs don't clip.
  const span = { fontSize: size, lineHeight: Math.round(size * 1.1), letterSpacing: displayTracking };
  return (
    <View style={styles.row}>
      {!hideMark && <Image source={LOGO} style={{ width: size + 10, height: size + 10 }} contentFit="contain" />}
      <Txt variant="display" color={color ?? colors.ink} style={span}>
        Octo
        <Txt variant="display" color={colors.accent} style={span}>
          Chat
        </Txt>
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
