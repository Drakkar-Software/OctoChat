import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { getElevation, radii, shadows, spacing } from '@/theme';
import type { Reaction } from '@drakkar.software/octochat-sdk';
import { plural } from '@drakkar.software/octochat-sdk';
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
  // Native has no pointer, so a long-press toggles the "who reacted" names;
  // on web hover drives it.
  const [revealed, setRevealed] = useState(false);
  const showWho = (hovered || revealed) && userIds.length > 0;
  const e3 = getElevation(colors).e3;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${emoji}, ${plural(count, 'reaction')}${mine ? ', including you' : ''}`}
      onPress={onPress}
      onLongPress={userIds.length ? () => setRevealed((v) => !v) : undefined}
      {...hoverProps}
      style={[
        styles.chip,
        {
          // e2-level chip: paper surface, faint border — no heavy filled ring
          backgroundColor: mine ? colors.accentBg : colors.paper,
          borderColor: mine ? colors.accentBorder : hovered ? colors.lineSoft : colors.lineFaint,
        },
      ]}
    >
      <Txt variant="callout">{emoji}</Txt>
      <Txt variant="caption" weight="semibold" mono color={mine ? colors.accentInk : colors.inkSoft}>
        {count}
      </Txt>
      {showWho ? (
        <View
          // Below the chip — one name per line so the card grows naturally.
          pointerEvents="none"
          style={[
            styles.tooltip,
            // e3 elevation: paper surface + lineSoft border + hairlineHi top + sm shadow
            { backgroundColor: e3.surface, borderColor: e3.border, borderTopColor: e3.topHairline },
            e3.shadow,
          ]}
        >
          {userIds.map((id) => (
            <Txt key={id} variant="caption" weight="medium" tone="ink" numberOfLines={1}>
              {nameFor?.(id) ?? id.slice(0, 8)}
            </Txt>
          ))}
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
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  tooltip: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: spacing.xs,
    maxWidth: 240,
    gap: 2,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderTopWidth: 1,
    zIndex: 10,
  },
});
