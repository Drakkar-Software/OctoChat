import { useState } from 'react';
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
}

/**
 * Notion-style workspace mode switch (Chat · Agents). When the row is wide
 * enough to show every label it does so; when it's cramped only the active mode
 * keeps its label and the rest collapse to their glyph. This is MEASURED, not
 * assumed — a hidden fully-expanded copy reports the natural width, compared
 * against the row's actual width — so the component keeps no width or platform
 * assumptions and stays reusable verbatim in the desktop sidebar and elsewhere.
 * The active mode and its setter are owned by {@link useViewMode}.
 */
export function ModeSwitcher({ mode, onChange }: ModeSwitcherProps) {
  // `avail` = the row's actual width (it stretches to its container); `natural` = the
  // width every label needs at once. Show all labels once they fit. Both start at 0, so
  // the first paint collapses (current behavior) until layout resolves a frame later.
  const [avail, setAvail] = useState(0);
  const [natural, setNatural] = useState(0);
  const expandAll = natural > 0 && avail >= natural;

  return (
    <View style={styles.row} onLayout={(e) => setAvail(e.nativeEvent.layout.width)}>
      {/* Off-layout measuring copy: every segment labeled, to learn the natural width. */}
      <View
        style={styles.measure}
        pointerEvents="none"
        onLayout={(e) => setNatural(e.nativeEvent.layout.width)}
      >
        {VIEW_MODES.map((m) => (
          <ModeSegment key={m.key} active={false} expanded label={m.label} iconName={m.iconName} onPress={noop} />
        ))}
      </View>
      {VIEW_MODES.map((m) => (
        <ModeSegment
          key={m.key}
          active={m.key === mode}
          expanded={expandAll}
          label={m.label}
          iconName={m.iconName}
          onPress={() => onChange(m.key)}
        />
      ))}
    </View>
  );
}

const noop = () => {};

function ModeSegment({
  active,
  expanded,
  label,
  iconName,
  onPress,
}: {
  active: boolean;
  /** Force the label visible even when inactive (the row has room for every label). */
  expanded: boolean;
  label: string;
  iconName: (typeof VIEW_MODES)[number]['iconName'];
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = useHover();
  // The active mode always shows its label; an inactive one only when the row has room.
  const showLabel = active || expanded;
  const bg = active ? colors.accentSoft : hovered ? colors.hover : 'transparent';
  const tint = active ? colors.accent : colors.inkMuted;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      {...hoverProps}
      style={[styles.segment, showLabel && styles.segmentLabeled, { backgroundColor: bg }]}
    >
      <Icon name={iconName} size={16} color={tint} />
      {showLabel ? (
        <Txt variant="footnote" weight="semibold" color={active ? colors.accentInk : colors.inkMuted} numberOfLines={1}>
          {label}
        </Txt>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  // The measuring copy sits off-layout (absolute) so it never affects the visible row's
  // width — which is exactly what `avail` reads.
  measure: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, opacity: 0 },
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
  // A segment showing its label pads wider than the icon-only rest.
  segmentLabeled: { paddingHorizontal: spacing.md },
});
