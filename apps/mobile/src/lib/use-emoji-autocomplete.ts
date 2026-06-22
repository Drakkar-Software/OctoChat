import { type RefObject, useCallback, useState } from 'react';
import {
  Platform,
  type NativeSyntheticEvent,
  type TextInput,
  type TextInputKeyPressEventData,
  type TextInputSelectionChangeEventData,
} from 'react-native';

import { activeEmojiQuery, matchEmoji, type EmojiMatch } from '@drakkar.software/octochat-sdk';

// react-native-web forwards the underlying keydown to `onKeyPress`, so the web
// event also carries `preventDefault` even though RN's type only promises `key`.
type WebKeyEvent = NativeSyntheticEvent<TextInputKeyPressEventData> & { preventDefault?: () => void };

/**
 * Drives the composer's `:shortcode:` emoji autocomplete. Tracks the caret via
 * `onSelectionChange`, derives the `:query` token the caret sits in, and exposes
 * the matching suggestions plus a `choose` that swaps the token for its glyph.
 *
 * The `<TextInput>` keeps its caret uncontrolled (no `selection` prop) so typing
 * is never jumpy — we only move the caret imperatively after inserting a glyph.
 * On web `onKeyPress` lets the open popup capture Arrow/Enter/Tab/Escape before
 * the composer's submit + edit-last shortcuts run; native has no key nav, so a
 * suggestion is chosen by tapping its row.
 */
export function useEmojiAutocomplete(inputRef: RefObject<TextInput | null>, text: string, setText: (t: string) => void) {
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  // Escape collapses the popup without moving the caret; the next caret change
  // (typing, clicking elsewhere) clears it so a fresh token re-opens it.
  const [dismissed, setDismissed] = useState(false);

  const token = activeEmojiQuery(text.slice(0, caret));
  const suggestions: EmojiMatch[] = token ? matchEmoji(token.query) : [];
  const open = !dismissed && suggestions.length > 0;
  // Keep the highlighted row in range as a narrowing query shrinks the list.
  const activeIndex = Math.min(active, Math.max(0, suggestions.length - 1));

  const onSelectionChange = useCallback((e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    setCaret(e.nativeEvent.selection.start);
    setActive(0);
    setDismissed(false);
  }, []);

  const choose = useCallback(
    (match?: EmojiMatch) => {
      const tok = activeEmojiQuery(text.slice(0, caret));
      const matches = tok ? matchEmoji(tok.query) : [];
      const pick = match ?? matches[Math.min(active, Math.max(0, matches.length - 1))];
      if (!tok || !pick) return;
      const before = text.slice(0, tok.start);
      const after = text.slice(caret);
      // Glyph + a single trailing space (skip it if one already follows the caret).
      const inserted = pick.glyph + (after.startsWith(' ') ? '' : ' ');
      const next = before.length + inserted.length;
      setText(before + inserted + after);
      setActive(0);
      setCaret(next);
      // Drop the caret right after the glyph once the new text has rendered.
      setTimeout(() => {
        if (Platform.OS === 'web') {
          const node = inputRef.current as unknown as
            | { focus?: () => void; setSelectionRange?: (s: number, e: number) => void }
            | null;
          node?.focus?.();
          node?.setSelectionRange?.(next, next);
        } else {
          // Keep the soft keyboard up if the row tap blurred the field, then
          // restore the caret after the glyph.
          inputRef.current?.focus?.();
          inputRef.current?.setNativeProps?.({ selection: { start: next, end: next } });
        }
      }, 0);
    },
    [text, caret, active, setText],
  );

  /** Web-only popup key nav. Returns `true` when it consumed the event so the
   *  caller skips the composer's own submit/edit-last handling. */
  const onKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>): boolean => {
      if (Platform.OS !== 'web' || !open) return false;
      const ev = e as WebKeyEvent;
      const n = suggestions.length;
      switch (ev.nativeEvent.key) {
        case 'ArrowDown':
          ev.preventDefault?.();
          setActive((i) => (i + 1) % n);
          return true;
        case 'ArrowUp':
          ev.preventDefault?.();
          setActive((i) => (i - 1 + n) % n);
          return true;
        case 'Enter':
        case 'Tab':
          ev.preventDefault?.();
          choose();
          return true;
        case 'Escape':
          ev.preventDefault?.();
          setDismissed(true);
          return true;
        default:
          return false;
      }
    },
    [open, suggestions.length, choose],
  );

  return { suggestions, open, activeIndex, setActive, choose, onSelectionChange, onKeyPress };
}
