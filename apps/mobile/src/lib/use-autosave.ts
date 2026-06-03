import { useCallback, useEffect, useRef, useState } from 'react';

import { motion } from '@/theme';

export interface AutosaveOptions {
  /** Seed text; read ONCE on mount. Live external updates are intentionally
   *  ignored while a field is open so a background merge/pull can't clobber what
   *  the user is typing — the field is mounted only for the cell being edited. */
  initialText: string;
  /** Persist the committed text. Called at most once per distinct value (see the
   *  commit-if-changed guard) — safe for an append-log where every call is a
   *  permanent entry. `final` is true on the blur/unmount flush, false on a
   *  debounce tick, so a caller can save in place while typing and apply a heavier
   *  transform (e.g. the doc's blank-line split) only on the final flush. */
  onCommit: (text: string, opts: { final: boolean }) => void;
  /** Idle delay before a debounced (mid-edit) commit. Use {@link motion.autosaveDoc}
   *  for merge-docs, {@link motion.autosaveLog} for append-logs. */
  debounceMs?: number;
  /** Whether an empty value is a meaningful commit. Docs: `true` (empty → the block
   *  is deleted). Titles: `false` (a blank title is never persisted — blurring an
   *  emptied field just reverts to the last value). Empty is ONLY ever resolved on
   *  the final flush (blur/unmount), never on a debounce tick, so clearing a field
   *  to retype can't delete it out from under the user. */
  commitEmpty?: boolean;
}

/**
 * The commit gate, pure so it can be tested without a renderer. Returns whether
 * `value` should be persisted given the last committed value and the trigger.
 *
 *  - Empty resolves ONLY on the final flush (blur/unmount) and ONLY when allowed
 *    (`commitEmpty` — docs delete the block; titles never persist blank), and at
 *    most once (so blur+unmount don't double-delete). It otherwise bypasses the
 *    unchanged check so a never-edited empty block is still dropped.
 *  - A changed non-empty value always commits, so typing autosaves and an append-log
 *    gains every distinct state.
 *  - An UNCHANGED non-empty value is skipped (the debounce+blur double-fire is a no-op;
 *    an append-log gets no per-keystroke dupes, and a merge-doc save is idempotent).
 */
export function shouldCommit(
  value: string,
  lastCommitted: string,
  opts: { final: boolean; commitEmpty: boolean; finalized?: boolean },
): boolean {
  if (!value.trim()) {
    if (!opts.final || !opts.commitEmpty) return false;
    return !(value === lastCommitted && opts.finalized);
  }
  return value !== lastCommitted;
}

export interface Autosave {
  value: string;
  onChangeText: (text: string) => void;
  /** Flush on blur — commits immediately (final). */
  onBlur: () => void;
  /** Force an immediate final commit (e.g. Enter / submit). */
  flush: () => void;
}

/**
 * Inline-edit autosave: no Save/Cancel — typing schedules a debounced commit and
 * blur/unmount flush it. Two guards keep it safe across both storage models:
 *
 *  1. **Commit-if-changed** — a commit no-ops unless the value actually differs
 *     from the last committed one, so the debounce+blur double-fire is harmless and
 *     an append-log only ever gains *distinct* states (never a per-keystroke entry).
 *  2. **Empty deferred to final** — an empty value is skipped on every debounce tick
 *     and only resolved on blur/unmount, and only when `commitEmpty`.
 *
 * The unmount flush is the real durability guarantee: on native, tapping a
 * non-interactive area often doesn't blur a `TextInput`, so blur alone would miss
 * commits — but closing the editor unmounts the field, and the cleanup flushes.
 */
export function useAutosave({ initialText, onCommit, debounceMs = motion.autosaveDoc, commitEmpty = false }: AutosaveOptions): Autosave {
  const [value, setValue] = useState(initialText);
  const valueRef = useRef(initialText);
  const committedRef = useRef(initialText);
  // Whether the latest committed value was already resolved on a final flush — gates the
  // empty-delete to once per edit (blur + unmount must not double-fire a delete).
  const finalizedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest onCommit without re-subscribing the unmount-flush effect (which must
  // run its cleanup exactly once, on unmount).
  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    onCommitRef.current = onCommit;
  });

  const commit = useCallback(
    (final: boolean) => {
      const text = valueRef.current;
      if (!shouldCommit(text, committedRef.current, { final, commitEmpty, finalized: finalizedRef.current })) return;
      committedRef.current = text;
      // A non-final (in-place) commit re-arms the next final empty-delete guard.
      finalizedRef.current = final;
      onCommitRef.current(text, { final });
    },
    [commitEmpty],
  );

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const onChangeText = useCallback(
    (text: string) => {
      setValue(text);
      valueRef.current = text;
      clearTimer();
      timerRef.current = setTimeout(() => commit(false), debounceMs);
    },
    [commit, debounceMs],
  );

  const flush = useCallback(() => {
    clearTimer();
    commit(true);
  }, [commit]);

  // Unmount flush — the durability backbone (see header). Held in a ref so the
  // cleanup subscribes once and fires ONLY on unmount, yet still calls the latest
  // flush (which reads the latest value/onCommit through their refs).
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => () => flushRef.current(), []);

  return { value, onChangeText, onBlur: flush, flush };
}
