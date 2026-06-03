import { Platform } from 'react-native';
import type { NativeSyntheticEvent, StyleProp, TextInputKeyPressEventData, ViewStyle } from 'react-native';

import { motion } from '@/theme';
import { useAutosave } from '@/lib/use-autosave';

import { TextField } from './TextField';

/** react-native-web forwards the keydown event, so the modifier/composition flags
 *  and `preventDefault` live on it even though RN's type only promises `key`. */
type WebKeyEvent = NativeSyntheticEvent<TextInputKeyPressEventData> & {
  shiftKey?: boolean;
  preventDefault?: () => void;
  nativeEvent: TextInputKeyPressEventData & { isComposing?: boolean };
};

interface AutosaveFieldProps {
  /** Seed text, read once on mount (see {@link useAutosave}). */
  initialText: string;
  /** Persist the committed text (debounced while typing, flushed on blur/close). `final`
   *  is true on the blur/unmount flush — branch on it to do heavier work (e.g. split)
   *  only then. */
  onCommit: (text: string, opts: { final: boolean }) => void;
  /** Leave edit mode (the caller unmounts this field, which triggers a final flush). */
  onClose?: () => void;
  /** Idle debounce; defaults to {@link motion.autosaveDoc}. Pass {@link motion.autosaveLog}
   *  for append-log-backed fields. */
  debounceMs?: number;
  /** Empty value is a real commit (docs delete on empty); titles leave this false. */
  commitEmpty?: boolean;
  multiline?: boolean;
  /** Borderless seamless surface (see {@link TextField} `plain`) — the doc editor. */
  plain?: boolean;
  /** Grow with content instead of scrolling inside a fixed box (see {@link TextField}). */
  autoGrow?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  minHeight?: number;
  accessibilityLabel?: string;
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Inline editor with no Save/Cancel — edits autosave (see {@link useAutosave}).
 * Replaces {@link MessageEditor} wherever editing should feel like a live document
 * rather than an explicit commit (doc blocks, project card/column titles).
 *
 * Exit gestures: blur flushes + closes; on web Escape closes (a single-line field
 * also closes on Enter); on native a single-line field closes on the keyboard's
 * return key (`onSubmitEditing`). Multiline keeps Enter as a newline so the doc's
 * blank-line block split still works.
 */
export function AutosaveField({
  initialText,
  onCommit,
  onClose,
  debounceMs = motion.autosaveDoc,
  commitEmpty = false,
  multiline = false,
  plain = false,
  autoGrow = false,
  placeholder,
  autoFocus = true,
  minHeight,
  accessibilityLabel,
  containerStyle,
}: AutosaveFieldProps) {
  const autosave = useAutosave({ initialText, onCommit, debounceMs, commitEmpty });

  const close = () => {
    autosave.flush();
    onClose?.();
  };

  // Web key handling differs from the Save/Cancel editor: there is no cancel, and
  // Enter is a newline (multiline docs) or close (single-line titles); Escape always
  // closes. Native single-line closes via the keyboard return key (onSubmitEditing).
  const onKeyPress =
    Platform.OS === 'web'
      ? (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
          const ev = e as WebKeyEvent;
          const key = ev.nativeEvent.key;
          if (key === 'Escape') {
            ev.preventDefault?.();
            close();
          } else if (key === 'Enter' && !multiline && !ev.shiftKey && !ev.nativeEvent.isComposing) {
            ev.preventDefault?.();
            close();
          }
        }
      : undefined;

  return (
    <TextField
      value={autosave.value}
      onChangeText={autosave.onChangeText}
      onBlur={close}
      multiline={multiline}
      plain={plain}
      autoGrow={autoGrow}
      {...(minHeight !== undefined ? { minHeight } : {})}
      autoFocus={autoFocus}
      placeholder={placeholder}
      accessibilityLabel={accessibilityLabel}
      containerStyle={containerStyle}
      {...(Platform.OS === 'web' ? { onKeyPress } : { onSubmitEditing: multiline ? undefined : close })}
    />
  );
}
