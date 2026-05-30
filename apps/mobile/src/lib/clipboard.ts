import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';

// How long the "Copied" confirmation stays before reverting to the idle label.
const COPIED_RESET_MS = 1600;

type Clip = { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } };

/**
 * Copy text to the clipboard. Native uses `expo-clipboard`; web uses the
 * `navigator.clipboard` API (kept as a path so it works under RN-Web without
 * the native module). Resolves to whether the copy actually happened so callers
 * can show feedback only on success.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (Platform.OS !== 'web') return await Clipboard.setStringAsync(text);
    const clip = (globalThis as Clip).navigator?.clipboard;
    if (!clip?.writeText) return false;
    await clip.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Copy-to-clipboard with a transient `copied` flag for button feedback. */
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async (text: string) => {
    const ok = await copyText(text);
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  }, []);

  return { copied, copy };
}
