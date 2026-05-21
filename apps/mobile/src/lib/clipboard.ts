import { useCallback, useEffect, useRef, useState } from 'react';

// How long the "Copied" confirmation stays before reverting to the idle label.
const COPIED_RESET_MS = 1600;

type Clip = { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } };

/**
 * Copy text to the clipboard. Web-only for now (no native clipboard dependency
 * is wired); resolves to whether the copy actually happened so callers can show
 * feedback only on success.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
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
