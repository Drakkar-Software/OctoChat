import { Pressable, StyleSheet, View } from 'react-native';

import { radii, shadows, spacing } from '@/theme';
import { useTheme } from '@/lib/use-theme';

import { Txt } from './Txt';

export interface Segment<T extends string = string> {
  key: T;
  label: string;
}

interface SegmentedControlProps<T extends string = string> {
  segments: readonly Segment<T>[];
  selected: T;
  onSelect: (key: T) => void;
}

/**
 * A two-or-more segment picker styled as a pill track — the active segment
 * lifts onto a card background while the track sits in a muted fill. Generic
 * over the key type so the caller gets type-safe selection values.
 */
export function SegmentedControl<T extends string>({ segments, selected, onSelect }: SegmentedControlProps<T>) {
  const { colors } = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: colors.fill }]}>
      {segments.map((seg) => {
        const active = seg.key === selected;
        return (
          <Pressable
            key={seg.key}
            style={[styles.segment, active && [styles.active, { backgroundColor: colors.paperAlt }]]}
            onPress={() => onSelect(seg.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={seg.label}
          >
            <Txt
              variant="caption"
              weight={active ? 'semibold' : 'regular'}
              style={{ color: active ? colors.ink : colors.inkMuted }}
            >
              {seg.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: radii.sm,
    padding: 3,
    gap: spacing.hair,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs + 1,
    borderRadius: radii.xs,
  },
  active: {
    shadowColor: shadows.sm.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
});
