/**
 * Characterization + parity tests for domain/ids (re-exported from octospaces-sdk).
 * These pin the behavior BEFORE and AFTER the thin re-export swap so any future SDK
 * drift is caught immediately.
 */
import { describe, it, expect } from 'vitest';
import { randomId, roomSlug } from './ids';
import { randomId as sdkRandomId, slugify as sdkRoomSlug } from '@drakkar.software/octospaces-sdk';

describe('randomId', () => {
  it('returns a 32-char lowercase hex string', () => {
    const id = randomId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('returns different values on each call', () => {
    expect(randomId()).not.toBe(randomId());
  });

  it('is parity with octospaces-sdk randomId (same format)', () => {
    // Both produce 32-char lowercase hex — same contract, different entropy each call.
    const local = randomId();
    const sdk = sdkRandomId();
    expect(local).toMatch(/^[0-9a-f]{32}$/);
    expect(sdk).toMatch(/^[0-9a-f]{32}$/);
    expect(local.length).toBe(sdk.length);
  });
});

describe('roomSlug', () => {
  it('lowercases input', () => {
    expect(roomSlug('General')).toBe('general');
  });

  it('maps non-alphanumeric runs to a single hyphen', () => {
    expect(roomSlug('Q&A')).toBe('q-a');
    expect(roomSlug('C++')).toBe('c');
    expect(roomSlug('foo  bar')).toBe('foo-bar');
  });

  it('trims leading and trailing hyphens', () => {
    expect(roomSlug('-hello-')).toBe('hello');
    expect(roomSlug('---hi---')).toBe('hi');
  });

  it('caps at 40 characters', () => {
    const long = 'a'.repeat(50);
    expect(roomSlug(long).length).toBe(40);
  });

  it('falls back to "item" for empty or all-special input', () => {
    expect(roomSlug('')).toBe('item');
    expect(roomSlug('   ')).toBe('item');
    expect(roomSlug('日本語')).toBe('item');
    expect(roomSlug('---')).toBe('item');
  });

  it('handles normal room names', () => {
    expect(roomSlug('general')).toBe('general');
    expect(roomSlug('random-stuff')).toBe('random-stuff');
    expect(roomSlug('design & ux')).toBe('design-ux');
  });

  it('is parity with octospaces-sdk roomSlug (identical output)', () => {
    const cases = ['General', 'Q&A', 'C++', 'café', 'foo  bar', '', '日本語', 'design & ux', 'a'.repeat(50)];
    for (const input of cases) {
      expect(roomSlug(input)).toBe(sdkRoomSlug(input));
    }
  });
});
