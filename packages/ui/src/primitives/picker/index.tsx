import React from 'react';
import { Picker as ExpoPicker } from '@expo/ui';

import { hostSeed, useHostWrap } from '../_host/host';
import { useOctoUITheme } from '../../theme/context';

export interface OctoPickerOption {
  label: string;
  value: string;
}

export interface OctoPickerProps {
  options: OctoPickerOption[];
  selectedValue: string;
  onValueChange: (value: string) => void;
  /** `'menu'` opens a dropdown on tap (default); `'wheel'` is an inline iOS rotor. */
  appearance?: 'menu' | 'wheel';
  /** Accent tone: `'default'` marine, `'desk'` amber OctoDesk. */
  tone?: 'default' | 'desk';
}

/**
 * Native single-selection picker — a menu/dropdown (default) or iOS wheel, via
 * the universal `@expo/ui` Picker. Tinted with the accent through the Host seed.
 */
export function Picker({ options, selectedValue, onValueChange, appearance = 'menu', tone = 'default' }: OctoPickerProps) {
  const theme = useOctoUITheme();
  return useHostWrap(
    <ExpoPicker selectedValue={selectedValue} onValueChange={onValueChange} appearance={appearance}>
      {options.map((o) => (
        <ExpoPicker.Item key={o.value} label={o.label} value={o.value} />
      ))}
    </ExpoPicker>,
    { matchContents: true, seedColor: hostSeed(theme, tone) },
  );
}

Picker.displayName = 'OctoPicker';
