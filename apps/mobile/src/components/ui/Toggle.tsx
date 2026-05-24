import { Switch } from 'react-native';

import { useTheme } from '@/lib/use-theme';

interface ToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}

/**
 * Themed on/off switch — wraps the platform `Switch` (iOS-style on iOS, material
 * on Android, the react-native-web fallback on web) so every settings toggle
 * picks up the marine accent track from one place rather than restyling inline.
 */
export function Toggle({ value, onValueChange, disabled, accessibilityLabel }: ToggleProps) {
  const { colors } = useTheme();
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      trackColor={{ false: colors.fillDeep, true: colors.accent }}
      thumbColor={colors.paper}
      ios_backgroundColor={colors.fillDeep}
    />
  );
}
