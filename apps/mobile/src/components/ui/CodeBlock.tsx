import { ScrollView, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';

import { CopyButton } from './CopyButton';
import { Txt } from './Txt';

/**
 * A fenced code block: a bordered, horizontally-scrollable monospace panel with a
 * floating copy button. Generic — used by the Markdown renderer for ```` ``` ````
 * blocks (and a candidate to back chat's {@link MessageBody} fenced block once
 * that refactor is separately verified).
 */
export function CodeBlock({ value }: { value: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.block, { backgroundColor: colors.codeBg, borderColor: colors.codeBorder }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Txt variant="caption" mono tone="inkSoft" selectable>
          {value}
        </Txt>
      </ScrollView>
      <View style={styles.copy}>
        <CopyButton value={value} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { borderRadius: radii.sm, borderWidth: 1, paddingVertical: spacing.sm },
  // Extra right padding keeps a short one-line snippet from sliding under the
  // floating copy button in the corner.
  scroll: { paddingLeft: spacing.sm, paddingRight: spacing.xxl },
  copy: { position: 'absolute', top: spacing.xs, right: spacing.xs },
});
