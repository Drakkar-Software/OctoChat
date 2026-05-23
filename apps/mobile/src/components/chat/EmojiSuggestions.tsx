import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import type { EmojiMatch } from '@/lib/emoji';
import { tapFeedback } from '@/lib/haptics';
import { useTheme } from '@/lib/use-theme';
import { Txt } from '@/components/ui/Txt';

interface EmojiSuggestionsProps {
  suggestions: EmojiMatch[];
  /** Index of the keyboard-highlighted row (web). */
  activeIndex: number;
  /** Insert this match's glyph, replacing the typed `:shortcode`. */
  onChoose: (match: EmojiMatch) => void;
  /** Sync the highlight to a hovered row (web). */
  onHover: (index: number) => void;
}

/**
 * Popup of `:shortcode:` matches shown above the composer while a colon code is
 * being typed. Tap a row — or, on web, press Enter/Tab on the highlighted one —
 * to insert its glyph. Mirrors the composer's quick-reaction palette styling.
 */
export function EmojiSuggestions({ suggestions, activeIndex, onChoose, onHover }: EmojiSuggestionsProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.list, { backgroundColor: colors.paperAlt, borderColor: colors.lineSoft }]}>
      {suggestions.map((s, i) => {
        const highlighted = i === activeIndex;
        return (
          <Pressable
            key={s.code}
            accessibilityRole="button"
            accessibilityLabel={`Insert :${s.code}:`}
            onHoverIn={() => onHover(i)}
            onPress={() => {
              tapFeedback();
              onChoose(s);
            }}
            style={[styles.item, highlighted ? { backgroundColor: colors.hover } : null]}
          >
            <Txt variant="subhead">{s.glyph}</Txt>
            <Txt variant="footnote" mono tone={highlighted ? 'ink' : 'inkMuted'}>
              :{s.code}:
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    marginBottom: spacing.sm,
    padding: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 2,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
});
