import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { COMPOSER_EMOJIS } from '@/lib/reactions';
import { useQuickReactions } from '@/lib/quick-reactions-context';
import { DEFAULT_QUICK_REACTIONS } from '@/lib/quick-reactions-settings';
import { useTheme } from '@/lib/use-theme';
import { Card } from '@/components/ui/Card';
import { Txt } from '@/components/ui/Txt';

/**
 * The QUICK REACTIONS section of the profile screen. Edits the six emojis offered
 * in the inline message reaction picker ({@link MessageActions}). Tap a slot to
 * select it, then tap an emoji from the palette to fill it; emojis already in the
 * palette are dimmed so the six stay distinct (positional keys guard the picker
 * either way). "Reset" restores the original set.
 */
export function QuickReactionsCard() {
  const { colors } = useTheme();
  const { emojis, update } = useQuickReactions();
  const [activeSlot, setActiveSlot] = useState(0);

  const assign = (glyph: string) => {
    if (emojis[activeSlot] === glyph) return;
    const next = emojis.slice();
    next[activeSlot] = glyph;
    update(next);
  };

  const changed = emojis.some((e, i) => e !== DEFAULT_QUICK_REACTIONS[i]);

  return (
    <Card title="QUICK REACTIONS">
      <Txt variant="footnote" tone="inkMuted">
        The six emojis offered when you react to a message. Tap a slot, then pick a replacement.
      </Txt>

      <View style={styles.slots}>
        {emojis.map((glyph, i) => {
          const active = i === activeSlot;
          return (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityLabel={`Quick reaction ${i + 1}: ${glyph}`}
              accessibilityState={{ selected: active }}
              onPress={() => setActiveSlot(i)}
              style={[
                styles.slot,
                {
                  backgroundColor: active ? colors.accentBg : colors.paperAlt,
                  borderColor: active ? colors.accent : colors.lineSoft,
                },
              ]}
            >
              <Txt variant="subhead">{glyph}</Txt>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.palette}>
        {COMPOSER_EMOJIS.map((glyph) => {
          // Dim emojis already in the palette (other than the active slot's own
          // value) so the six reactions stay distinct — duplicate glyphs would
          // collide on key and confuse the picker.
          const taken = emojis.includes(glyph) && emojis[activeSlot] !== glyph;
          return (
            <Pressable
              key={glyph}
              accessibilityRole="button"
              accessibilityLabel={`Use ${glyph}`}
              accessibilityState={{ disabled: taken }}
              disabled={taken}
              onPress={() => assign(glyph)}
              style={[styles.paletteItem, { borderColor: colors.lineFaint }, taken ? styles.taken : null]}
            >
              <Txt variant="subhead">{glyph}</Txt>
            </Pressable>
          );
        })}
      </View>

      {changed ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => update(DEFAULT_QUICK_REACTIONS)}
          hitSlop={6}
          style={styles.reset}
        >
          <Txt variant="footnote" weight="semibold" tone="accent">
            Reset to defaults
          </Txt>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  slots: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  slot: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
  },
  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
  paletteItem: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    borderWidth: 1,
  },
  taken: { opacity: 0.3 },
  reset: { marginTop: spacing.md, alignSelf: 'flex-start' },
});
