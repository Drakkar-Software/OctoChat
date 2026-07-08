import React from 'react';
import { Platform } from 'react-native';
import { Switch as ExpoSwitch } from '@expo/ui';
import type { SwitchProps } from '@expo/ui';

import { labelsHidden } from '../_host/modifiers';
import { hostSeed, useHostWrap } from '../_host/host';
import { useOctoUITheme } from '../../theme/context';

export interface OctoSwitchProps extends SwitchProps {
  /** Accent tone for the ON state: `'default'` marine, `'desk'` amber OctoDesk. */
  tone?: 'default' | 'desk';
  /** VoiceOver/TalkBack label. The universal Switch has no such prop, so it is
   *  applied to the Host view that wraps the control. */
  accessibilityLabel?: string;
}

/**
 * Native on/off switch — SwiftUI `Toggle` on iOS, Material `Switch` on Android,
 * the react-native-web fallback on web. The ON tint is derived from the Host
 * `seedColor` (the accent), so the switch reads as marine, not OS-default.
 */
export function Switch({ tone = 'default', accessibilityLabel, modifiers, ...props }: OctoSwitchProps) {
  const theme = useOctoUITheme();

  // Without `.labelsHidden()` the SwiftUI Toggle reserves its (empty) label's
  // line box, so the switch top-aligns inside a taller box and reads as
  // vertically "high" in a centered row. iOS-only: it's a SwiftUI modifier;
  // Android (Compose) / web don't have the bug and must not be handed a modifier
  // their layer doesn't recognize.
  const merged = Platform.OS === 'ios' ? [...(modifiers ?? []), labelsHidden()] : modifiers;

  // Host defaults to non-content-hugging sizing, which stretches the toggle to
  // fill the remaining width of its flex-row. matchContents hugs both axes to the
  // control's intrinsic size; alignSelf centers it vertically in the row.
  return useHostWrap(<ExpoSwitch {...props} modifiers={merged} />, {
    matchContents: true,
    seedColor: hostSeed(theme, tone),
    style: { alignSelf: 'center' },
    accessibilityLabel,
    accessibilityRole: 'switch',
  });
}

Switch.displayName = 'OctoSwitch';
