import React from 'react';
import NativeDateTimePicker from '@expo/ui/community/datetime-picker';

import { useOctoUITheme } from '../../theme/context';

export interface OctoDateTimePickerProps {
  /** Controlled value. */
  value: Date;
  /** Called with the newly selected date. */
  onChange: (date: Date) => void;
  /** @default 'time' */
  mode?: 'date' | 'time' | 'datetime';
  /** Accent tone: `'default'` marine, `'desk'` amber OctoDesk. */
  tone?: 'default' | 'desk';
}

/**
 * Native date/time picker via the `@expo/ui` community drop-in. Renders inline
 * (a spinner for time, an inline calendar for date) tinted with the accent and
 * matching the app light/dark theme. Self-hosting — no `Host` wrapper.
 */
export function DateTimePicker({ value, onChange, mode = 'time', tone = 'default' }: OctoDateTimePickerProps) {
  const theme = useOctoUITheme();
  return (
    <NativeDateTimePicker
      value={value}
      mode={mode}
      display={mode === 'time' ? 'spinner' : 'inline'}
      accentColor={tone === 'desk' ? theme.colors.accentDesk : theme.colors.accent}
      themeVariant={theme.scheme === 'dark' ? 'dark' : 'light'}
      onValueChange={(_event, date) => onChange(date)}
    />
  );
}

DateTimePicker.displayName = 'OctoDateTimePicker';
