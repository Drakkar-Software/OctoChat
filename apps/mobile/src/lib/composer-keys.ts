import { Platform } from 'react-native';
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from 'react-native';

/**
 * react-native-web forwards the underlying React keydown event to `onKeyPress`,
 * so on web the modifier flag, IME-composition flag and `preventDefault` all live
 * on the event even though RN's type only promises `nativeEvent.key`.
 */
type WebKeyEvent = NativeSyntheticEvent<TextInputKeyPressEventData> & {
  shiftKey?: boolean;
  preventDefault?: () => void;
  nativeEvent: TextInputKeyPressEventData & { isComposing?: boolean };
};

/**
 * Composer Enter-to-send handler. On web a bare Enter submits the message while
 * Shift+Enter falls through to insert a newline (and Enter mid-IME-composition is
 * ignored). On native, Enter keeps its default newline behaviour in a multiline
 * field, so no handler is attached.
 */
export function submitOnEnter(submit: () => void) {
  if (Platform.OS !== 'web') return undefined;
  return (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const ev = e as WebKeyEvent;
    if (ev.nativeEvent.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
      ev.preventDefault?.();
      submit();
    }
  };
}
