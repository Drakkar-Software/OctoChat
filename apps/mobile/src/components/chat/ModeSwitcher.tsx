import { Pressable, StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { useHover } from '@/lib/use-hover';
import { useTheme } from '@/lib/use-theme';
import { VIEW_MODES, type ViewMode } from '@/lib/view-mode';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface ModeSwitcherProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  /** Trailing search affordance, pinned to the end of the row in the same
   *  segment style (icon-only). Desktop passes this in place of the old
   *  "Jump to…" input; mobile omits it (its header carries search). */
  onSearch?: () => void;
}

/**
 * Notion-style workspace mode switch: a compact row of glyphs where only the
 * active one expands to show its label (Chat · Agents · Work). Purely
 * presentational — the active mode and its setter are owned by
 * {@link useViewMode}. Reused verbatim in the desktop sidebar and the mobile
 * rooms screen, so it carries no width or platform assumptions.
 */
export function ModeSwitcher({ mode, onChange, onSearch }: ModeSwitcherProps) {
  return (
    <View style={styles.row}>
      {VIEW_MODES.map((m) => (
        <ModeSegment
          key={m.key}
          active={m.key === mode}
          label={m.label}
          iconName={m.iconName}
          onPress={() => onChange(m.key)}
        />
      ))}
      {onSearch ? (
        <>
          <View style={styles.spacer} />
          {/* Never "active" — an icon-only segment that routes to search. */}
          <ModeSegment active={false} label="Search" iconName="search" onPress={onSearch} />
        </>
      ) : null}
    </View>
  );
}

function ModeSegment({
  active,
  label,
  iconName,
  onPress,
}: {
  active: boolean;
  label: string;
  iconName: (typeof VIEW_MODES)[number]['iconName'];
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  const bg = active ? colors.accentSoft : hovered ? colors.hover : 'transparent';
  const tint = active ? colors.accent : colors.inkMuted;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      {...hoverProps}
      style={[styles.segment, active && styles.segmentActive, { backgroundColor: bg }]}
    >
      <Icon name={iconName} size={16} color={tint} />
      {active ? (
        <Txt variant="footnote" weight="semibold" color={colors.accentInk} numberOfLines={1}>
          {label}
        </Txt>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  spacer: { flex: 1 },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 34,
    minWidth: 34,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
  },
  // Active segment carries the label, so it pads wider than the icon-only rest.
  segmentActive: { paddingHorizontal: spacing.md },
});
