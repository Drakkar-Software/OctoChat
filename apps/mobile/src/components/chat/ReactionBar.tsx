import { StyleSheet, View } from 'react-native';

import { radii } from '@/theme';
import type { Reaction } from '@/lib/types';
import { useTheme } from '@/lib/use-theme';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

function ReactionChip({ emoji, count, mine }: Reaction) {
  const { colors } = useTheme();
  return (
    <View
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
    </View>
  );
}

/** Row of emoji reactions plus an "add reaction" affordance. */
export function ReactionBar({ reactions }: { reactions: Reaction[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      {reactions.map((r) => (
        <ReactionChip key={r.emoji} {...r} />
      ))}
      <View style={[styles.add, { borderColor: colors.lineFaint, backgroundColor: colors.surface }]}>
        <Icon name="smile" size={13} color={colors.inkMuted} />
      </View>
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
