import { Pressable, StyleSheet, View } from 'react-native';

import { radii } from '@/theme';
import type { Reaction } from '@/lib/types';
import { tapFeedback } from '@/lib/haptics';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

function ReactionChip({ emoji, count, mine, onPress }: Reaction & { onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: mine ? colors.accentBg : colors.fill,
          borderColor: mine ? colors.accentBorder : colors.lineFaint,
        },
      ]}
    >
      <Txt variant="footnote">{emoji}</Txt>
      <Txt variant="micro" weight="semibold" mono color={mine ? colors.accentInk : colors.inkSoft}>
        {count}
      </Txt>
    </Pressable>
  );
}

/** Row of emoji reactions; tap a chip to toggle, tap + to add a quick reaction. */
export function ReactionBar({
  reactions,
  onToggle,
  onAdd,
}: {
  reactions: Reaction[];
  onToggle?: (emoji: string) => void;
  onAdd?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      {reactions.map((r) => (
        <ReactionChip
          key={r.emoji}
          {...r}
          onPress={() => {
            tapFeedback();
            onToggle?.(r.emoji);
          }}
        />
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add reaction"
        onPress={() => {
          tapFeedback();
          onAdd?.();
        }}
        style={[styles.add, { borderColor: colors.lineFaint, backgroundColor: colors.surface }]}
      >
        <Icon name="smile" size={13} color={colors.inkMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  add: {
    width: 30,
    height: 24,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
