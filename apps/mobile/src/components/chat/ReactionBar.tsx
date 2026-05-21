import { Pressable, StyleSheet, View } from 'react-native';

import { radii, shadows } from '@/theme';
import type { Reaction } from '@/lib/types';
import { tapFeedback } from '@/lib/haptics';
import { useHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';
import { Txt } from '@/components/ui/Txt';

type ReactionChipProps = Reaction & {
  onPress?: () => void;
  /** Resolve a reactor's id to a display name for the hover tooltip. */
  nameFor?: (userId: string) => string;
};

function ReactionChip({ emoji, count, mine, userIds, nameFor, onPress }: ReactionChipProps) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  const names = hovered ? userIds.map((id) => nameFor?.(id) ?? id.slice(0, 8)) : [];

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      {...hoverProps}
      style={[
        styles.chip,
        {
          backgroundColor: mine ? colors.accentBg : colors.fill,
          borderColor: mine ? colors.accentBorder : hovered ? colors.accentBorder : colors.lineFaint,
        },
      ]}
    >
      <Txt variant="footnote">{emoji}</Txt>
      <Txt variant="micro" weight="semibold" mono color={mine ? colors.accentInk : colors.inkSoft}>
        {count}
      </Txt>
      {hovered && names.length ? (
        <View
          // Below the chip: more room than above and clear of the topbar.
          pointerEvents="none"
          style={[
            styles.tooltip,
            { backgroundColor: colors.paper, borderColor: colors.lineSoft, borderTopColor: colors.hairlineHi },
            shadows.sm,
          ]}
        >
          <Txt variant="micro" weight="medium" tone="ink" numberOfLines={6}>
            {names.join(', ')}
          </Txt>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Inline row of a message's existing reactions; tap a chip to toggle yours, hover
 * one to see who reacted. Adding a *new* reaction lives in the message's hover
 * toolbar (see {@link MessageActions}), so this renders nothing when empty.
 */
export function ReactionBar({
  reactions,
  onToggle,
  nameFor,
}: {
  reactions: Reaction[];
  onToggle?: (emoji: string) => void;
  nameFor?: (userId: string) => string;
}) {
  if (reactions.length === 0) return null;
  return (
    <View style={styles.row}>
      {reactions.map((r) => (
        <ReactionChip
          key={r.emoji}
          {...r}
          nameFor={nameFor}
          onPress={() => {
            tapFeedback();
            onToggle?.(r.emoji);
          }}
        />
      ))}
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
  tooltip: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 6,
    maxWidth: 240,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: radii.sm,
    borderWidth: 1,
    zIndex: 10,
  },
});
