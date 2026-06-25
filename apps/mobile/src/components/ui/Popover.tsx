import type { ReactNode } from 'react';
import type { ViewStyle } from 'react-native';

import { Overlay } from './Overlay';

interface PopoverProps {
  visible: boolean;
  onClose: () => void;
  /** Absolute-position style that positions the popover near its anchor. */
  anchorStyle: ViewStyle;
  children: ReactNode;
}

/**
 * Lightweight floating popover anchored to an absolute screen position.
 * Built on {@link Overlay} with `placement="anchor"` — the scrim, Escape key,
 * and fade animation are handled automatically.
 *
 * The caller controls all content styling; this just wires up dismissal
 * and the anchor position.
 */
export function Popover({ visible, onClose, anchorStyle, children }: PopoverProps) {
  return (
    <Overlay visible={visible} onClose={onClose} placement="anchor" anchorStyle={anchorStyle}>
      {children}
    </Overlay>
  );
}
