import { useMemo } from 'react';
import { Platform } from 'react-native';
import { SegmentedControl as NativeSegmentedControl } from '@octochat/ui';

import { tapFeedback } from '@/lib/haptics';

import { SegmentedControlPill, type Segment } from './SegmentedControlPill';

export type { Segment };

interface SegmentedControlProps<T extends string = string> {
  segments: readonly Segment<T>[];
  selected: T;
  onSelect: (key: T) => void;
}

/**
 * Native segmented control on iOS (real `UISegmentedControl` via `@octochat/ui`)
 * with a selection haptic; Android keeps the react-native pill track (Material
 * segmented content-color rendering is unreliable). Web uses the base sibling.
 */
export function SegmentedControl<T extends string>({ segments, selected, onSelect }: SegmentedControlProps<T>) {
  if (Platform.OS !== 'ios') {
    return <SegmentedControlPill segments={segments} selected={selected} onSelect={onSelect} />;
  }
  return <IosSegmentedControl segments={segments} selected={selected} onSelect={onSelect} />;
}

function IosSegmentedControl<T extends string>({ segments, selected, onSelect }: SegmentedControlProps<T>) {
  const values = useMemo(() => segments.map((s) => s.label), [segments]);
  const selectedIndex = Math.max(0, segments.findIndex((s) => s.key === selected));
  return (
    <NativeSegmentedControl
      values={values}
      selectedIndex={selectedIndex}
      onIndexChange={(index) => {
        const seg = segments[index];
        if (!seg || seg.key === selected) return;
        tapFeedback();
        onSelect(seg.key);
      }}
    />
  );
}
