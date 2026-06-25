import { Switch } from 'react-native';

import { useTheme } from '@/lib/use-theme';

interface ToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  /** Track accent to apply when the toggle is on.
   *  `'default'` uses the marine `accent`; `'desk'` uses the amber `accentDesk`. */
  tone?: 'default' | 'desk';
}

/**
 * Themed on/off switch — wraps the platform `Switch` (iOS-style on iOS, material
 * on Android, the react-native-web fallback on web) so every settings toggle
 * picks up the marine accent track from one place rather than restyling inline.
 * Pass `tone="desk"` to use the amber OctoDesk accent track instead.
 */
export function Toggle({ value, onValueChange, disabled, accessibilityLabel, tone = 'default' }: ToggleProps) {
  const { colors } = useTheme();
  const trueColor = tone === 'desk' ? colors.accentDesk : colors.accent;
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      trackColor={{ false: colors.fill, true: trueColor }}
      thumbColor={colors.paper}
      ios_backgroundColor={colors.fill}
    />
  );
}
