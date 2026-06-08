/**
 * The commit gate for inline-edit autosave — pure so it can be tested without a
 * renderer and reused by any host. The React `useAutosave` hook (timers, refs, the
 * unmount flush) stays in the app and calls this to decide whether a value should be
 * persisted given the last committed value and the trigger.
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
