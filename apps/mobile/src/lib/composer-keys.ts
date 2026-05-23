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
 * Composer key handler (web only). A bare Enter submits the message while
 * Shift+Enter falls through to insert a newline (and Enter mid-IME-composition is
 * ignored). When `onEditLast` is supplied, ArrowUp on an empty composer
 * (`canEditLast()` true, and not mid-composition) opens the viewer's last message
 * for editing instead of moving the caret — the Slack/Discord "edit last" gesture.
 * On native, keys keep their default newline behaviour, so no handler is attached.
 */
export function submitOnEnter(submit: () => void, onEditLast?: () => void, canEditLast?: () => boolean) {
  if (Platform.OS !== 'web') return undefined;
  return (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const ev = e as WebKeyEvent;
    if (ev.nativeEvent.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
      ev.preventDefault?.();
      submit();
    } else if (ev.nativeEvent.key === 'ArrowUp' && !ev.nativeEvent.isComposing && onEditLast && canEditLast?.()) {
      ev.preventDefault?.();
      onEditLast();
    }
  };
}

/**
 * Inline-editor key handler (web only): bare Enter saves, Escape cancels, and
 * Shift+Enter falls through to insert a newline. Mirrors {@link submitOnEnter}'s
 * Enter-to-submit but adds the Escape-to-cancel an edit box needs (and omits its
 * composer-only ArrowUp shortcut); native keeps defaults.
 */
export function submitOnEnterCancelOnEsc(submit: () => void, cancel: () => void) {
  if (Platform.OS !== 'web') return undefined;
  return (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const ev = e as WebKeyEvent;
    if (ev.nativeEvent.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
      ev.preventDefault?.();
      submit();
    } else if (ev.nativeEvent.key === 'Escape') {
      ev.preventDefault?.();
      cancel();
    }
  };
}
