import React from 'react';
import NativeSegmentedControl from '@expo/ui/community/segmented-control';

import { useOctoUITheme } from '../../theme/context';

export interface OctoSegmentedControlProps {
  /** Segment labels, in order. */
  values: string[];
  /** Index of the selected segment. */
  selectedIndex: number;
  /** Called with the newly selected segment index. */
  onIndexChange: (index: number) => void;
  /** Accent tone: `'default'` marine, `'desk'` amber OctoDesk. */
  tone?: 'default' | 'desk';
}

/**
 * Native segmented control — `UISegmentedControl` on iOS via the `@expo/ui`
 * community drop-in. Tinted with the marine accent; appearance follows the app
 * theme. This is a standalone native view (not Host-based), so no `useHostWrap`.
 */
export function SegmentedControl({ values, selectedIndex, onIndexChange, tone = 'default' }: OctoSegmentedControlProps) {
  const theme = useOctoUITheme();
  const tintColor = tone === 'desk' ? theme.colors.accentDesk : theme.colors.accent;
  return (
    <NativeSegmentedControl
      values={values}
      selectedIndex={selectedIndex}
      onChange={(e) => onIndexChange(e.nativeEvent.selectedSegmentIndex)}
      tintColor={tintColor}
      appearance={theme.scheme === 'dark' ? 'dark' : 'light'}
    />
  );
}

SegmentedControl.displayName = 'OctoSegmentedControl';
