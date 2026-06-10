import { describe, expect, it } from 'vitest';

import { parseSuggestionAction, type SuggestionCaps } from './prompt';

const ALL: SuggestionCaps = { canThread: true, canPin: true };
const NONE: SuggestionCaps = { canThread: false, canPin: false };

describe('parseSuggestionAction', () => {
  it('parses a tagged reply, stripping the keyword', () => {
    expect(parseSuggestionAction('REPLY: sounds good to me', ALL)).toEqual({ kind: 'reply', text: 'sounds good to me' });
  });

  it('treats untagged output as a plain reply (model ignored the format)', () => {
    expect(parseSuggestionAction('sounds good to me', ALL)).toEqual({ kind: 'reply', text: 'sounds good to me' });
  });

  it('parses a react action and extracts the emoji', () => {
    expect(parseSuggestionAction('REACT: 👍', ALL)).toEqual({ kind: 'react', emoji: '👍' });
  });

  it('drops a react with no real emoji', () => {
    expect(parseSuggestionAction('REACT: thumbs up', ALL)).toBeNull();
  });

  it('parses a thread with a starter reply (the combo)', () => {
    expect(parseSuggestionAction('THREAD: let us discuss the rollout', ALL)).toEqual({
      kind: 'thread',
      text: 'let us discuss the rollout',
    });
  });

  it('parses a bare thread (no starter reply)', () => {
    expect(parseSuggestionAction('THREAD:', ALL)).toEqual({ kind: 'thread' });
  });

  it('parses a pin action', () => {
    expect(parseSuggestionAction('PIN:', ALL)).toEqual({ kind: 'pin' });
  });

  it('falls back to reply when thread is unavailable but had content', () => {
    expect(parseSuggestionAction('THREAD: good point', NONE)).toEqual({ kind: 'reply', text: 'good point' });
  });

  it('drops a pin when pinning is unavailable', () => {
    expect(parseSuggestionAction('PIN:', NONE)).toBeNull();
  });

  it('waits (null) while only a bare keyword prefix has streamed', () => {
    expect(parseSuggestionAction('REP', ALL)).toBeNull();
    expect(parseSuggestionAction('THRE', ALL)).toBeNull();
  });

  it('waits (null) on an empty reply keyword with no content yet', () => {
    expect(parseSuggestionAction('REPLY:', ALL)).toBeNull();
  });

  it('is case-insensitive on the keyword', () => {
    expect(parseSuggestionAction('reply: hi there', ALL)).toEqual({ kind: 'reply', text: 'hi there' });
  });
});
