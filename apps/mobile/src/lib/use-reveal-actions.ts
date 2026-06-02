import { useCallback, useState } from 'react';

import { useRowHover } from './use-hover';

/**
 * Reveal a row's secondary actions (e.g. a delete button) CROSS-PLATFORM. On web they
 * appear on pointer hover; native has no pointer, so a long-press on the row toggles
 * them instead — without which hover-only controls are permanently unreachable on
 * iOS/Android. Spread `rowProps` on the row's container `View` (web hover) and wire
 * `onLongPress` onto the row's main `Pressable`; gate the action node on `revealed`, and
 * call `hide()` once the action fires (or to dismiss).
 *
 *   const { revealed, rowProps, onLongPress, hide } = useRevealActions();
 *   <View {...rowProps}>
 *     <Pressable onPress={onPrimary} onLongPress={onLongPress} … />
 *     {revealed ? <IconButton … onPress={() => { hide(); onDelete(); }} /> : null}
 *   </View>
 */
export function useRevealActions() {
  const { hovered, hoverProps } = useRowHover();
  const [pressed, setPressed] = useState(false);
  const onLongPress = useCallback(() => setPressed(true), []);
  const hide = useCallback(() => setPressed(false), []);
  return { revealed: hovered || pressed, rowProps: hoverProps, onLongPress, hide };
}
