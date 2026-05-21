import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { radii } from '@/theme';
import type { Reaction } from '@/lib/types';
import { tapFeedback } from '@/lib/haptics';
import { QUICK_REACTIONS } from '@/lib/reactions';
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

/** Row of emoji reactions; tap a chip to toggle, tap + to pick from the palette. */
export function ReactionBar({
  reactions,
  onToggle,
}: {
  reactions: Reaction[];
  onToggle?: (emoji: string) => void;
}) {
  const { colors } = useTheme();
  const [picking, setPicking] = useState(false);
  const mine = new Set(reactions.filter((r) => r.mine).map((r) => r.emoji));

  const pick = (emoji: string) => {
    tapFeedback();
    onToggle?.(emoji);
    setPicking(false);
  };

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
      {picking ? (
        <>
          {QUICK_REACTIONS.map((emoji) => (
            <Pressable
              key={emoji}
              accessibilityRole="button"
              accessibilityLabel={`React with ${emoji}`}
              onPress={() => pick(emoji)}
              style={[
                styles.add,
                {
                  borderColor: mine.has(emoji) ? colors.accentBorder : colors.lineFaint,
                  backgroundColor: mine.has(emoji) ? colors.accentBg : colors.surface,
                },
              ]}
            >
              <Txt variant="footnote">{emoji}</Txt>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close reaction picker"
            onPress={() => setPicking(false)}
            style={[styles.add, { borderColor: colors.lineFaint, backgroundColor: colors.surface }]}
          >
            <Icon name="x" size={12} color={colors.inkMuted} />
          </Pressable>
        </>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add reaction"
          onPress={() => {
            tapFeedback();
            setPicking(true);
          }}
          style={[styles.add, { borderColor: colors.lineFaint, backgroundColor: colors.surface }]}
        >
          <Icon name="smile" size={13} color={colors.inkMuted} />
        </Pressable>
      )}
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
