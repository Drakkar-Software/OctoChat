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
});
