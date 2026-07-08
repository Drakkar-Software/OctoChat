import { Switch } from '@octochat/ui';

interface ToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  /** Track accent when on: `'default'` marine `accent`, `'desk'` amber `accentDesk`. */
  tone?: 'default' | 'desk';
}

/**
 * Native on/off switch — real SwiftUI `Toggle` (iOS) / Material `Switch` (Android)
 * via `@octochat/ui`, tinted with the marine accent from the Host seed color.
 * The web build uses the react-native `Switch` sibling (`Toggle.tsx`) so the
 * themed track colors are preserved there.
 */
export function Toggle({ value, onValueChange, disabled, accessibilityLabel, tone = 'default' }: ToggleProps) {
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      tone={tone}
    />
  );
}
