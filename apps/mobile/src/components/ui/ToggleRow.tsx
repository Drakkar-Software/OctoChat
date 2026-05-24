import { View } from 'react-native';

import type { IconName } from './Icon';
import { Row } from './Row';
import { Toggle } from './Toggle';

interface ToggleRowProps {
  iconName?: IconName;
  title: string;
  detail?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  /** Dims the row and blocks the switch — for a sub-setting gated behind a master toggle. */
  disabled?: boolean;
}

/** A settings {@link Row} whose trailing accessory is a {@link Toggle}. */
export function ToggleRow({ iconName, title, detail, value, onValueChange, disabled }: ToggleRowProps) {
  return (
    // Match the disabled treatment used by Button (opacity 0.45).
    <View style={disabled ? { opacity: 0.45 } : undefined}>
      <Row
        iconName={iconName}
        title={title}
        detail={detail}
        right={
          <Toggle value={value} onValueChange={onValueChange} disabled={disabled} accessibilityLabel={title} />
        }
      />
    </View>
  );
}
