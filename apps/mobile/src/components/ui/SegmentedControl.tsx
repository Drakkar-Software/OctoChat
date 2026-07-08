import { SegmentedControlPill, type Segment } from './SegmentedControlPill';

export type { Segment };

interface SegmentedControlProps<T extends string = string> {
  segments: readonly Segment<T>[];
  selected: T;
  onSelect: (key: T) => void;
}

/**
 * A two-or-more segment picker. On web it renders the react-native pill track;
 * on native, the `.native` sibling swaps in the native `UISegmentedControl`
 * (iOS) while keeping the pill on Android.
 */
export function SegmentedControl<T extends string>(props: SegmentedControlProps<T>) {
  return <SegmentedControlPill {...props} />;
}
