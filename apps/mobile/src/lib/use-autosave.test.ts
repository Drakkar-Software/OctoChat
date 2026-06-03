import { describe, expect, it } from 'vitest';

import { shouldCommit } from './use-autosave';

describe('shouldCommit', () => {
  const doc = { commitEmpty: true }; // merge-doc / block: empty deletes
  const title = { commitEmpty: false }; // append-log title: never blank

  it('commits a changed non-empty value (debounce tick)', () => {
    expect(shouldCommit('hello', '', { final: false, ...doc })).toBe(true);
    expect(shouldCommit('hello', '', { final: false, ...title })).toBe(true);
  });

  it('skips an unchanged non-empty value — double-fire is a no-op, log gains no dupes', () => {
    expect(shouldCommit('hello', 'hello', { final: false, ...doc })).toBe(false);
    expect(shouldCommit('hello', 'hello', { final: true, ...title })).toBe(false);
  });

  it('never resolves empty on a debounce tick — clearing to retype cannot delete mid-edit', () => {
    expect(shouldCommit('', 'hello', { final: false, ...doc })).toBe(false);
    expect(shouldCommit('   ', 'hello', { final: false, ...doc })).toBe(false);
  });

  it('deletes on a final empty flush when commitEmpty (doc block), bypassing the unchanged check', () => {
    expect(shouldCommit('', 'hello', { final: true, ...doc })).toBe(true);
    // never-edited empty block: value still equals its empty seed, still dropped
    expect(shouldCommit('', '', { final: true, ...doc })).toBe(true);
  });

  it('never persists a blank title, even on a final flush (commitEmpty false)', () => {
    expect(shouldCommit('', 'Todo', { final: true, ...title })).toBe(false);
    expect(shouldCommit('   ', 'Todo', { final: true, ...title })).toBe(false);
  });

  it('only deletes once on the final flush — a second (unmount) flush is a no-op', () => {
    // first final empty flush runs (finalized still false)
    expect(shouldCommit('', '', { final: true, commitEmpty: true, finalized: false })).toBe(true);
    // second final empty flush: already finalized, same value → skip (no double-delete)
    expect(shouldCommit('', '', { final: true, commitEmpty: true, finalized: true })).toBe(false);
  });

  describe('finalizeAlways (doc blank-line split on blur, never mid-typing)', () => {
    it('runs the split on the final flush even when the in-place debounce saved the same text', () => {
      // debounce already committed "A\n\nB" in place → unchanged on blur, but the
      // split has not run yet (finalized false) → re-commit so editBlock splits.
      expect(shouldCommit('A\n\nB', 'A\n\nB', { final: true, commitEmpty: true, finalizeAlways: true, finalized: false })).toBe(true);
    });

    it('does NOT re-run the split on the unmount flush after blur already split it', () => {
      expect(shouldCommit('A\n\nB', 'A\n\nB', { final: true, commitEmpty: true, finalizeAlways: true, finalized: true })).toBe(false);
    });

    it('never splits on a debounce tick (non-final), only saves in place when changed', () => {
      // unchanged mid-typing → skip; the split is reserved for the final flush
      expect(shouldCommit('A\n\nB', 'A\n\nB', { final: false, commitEmpty: true, finalizeAlways: true, finalized: false })).toBe(false);
      // changed mid-typing → in-place save (no split — that's the caller's branch)
      expect(shouldCommit('A\n\nB', 'A', { final: false, commitEmpty: true, finalizeAlways: true, finalized: false })).toBe(true);
    });

    it('without finalizeAlways, an unchanged final flush is a no-op (append-log gets no dup)', () => {
      expect(shouldCommit('Todo', 'Todo', { final: true, ...title })).toBe(false);
    });
  });
});
