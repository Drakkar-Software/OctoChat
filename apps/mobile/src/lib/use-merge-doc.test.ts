import { describe, expect, it } from 'vitest';
import { resolveMemberCap, resolveMemberAuth } from './space-cap';

describe('resolveMemberCap', () => {
  const fallback = { fallbackCap: true };

  it('parses and returns the cap object for a valid member-kind entry', () => {
    const cap = { scope: { paths: ['spaces/sp1/**'] } };
    const entry = { kind: 'member' as const, cap: JSON.stringify(cap) };
    expect(resolveMemberCap(entry, fallback)).toEqual(cap);
  });

  it('returns fallback (no throw) for a member-kind entry with corrupt JSON', () => {
    const entry = { kind: 'member' as const, cap: '{corrupt json' };
    expect(resolveMemberCap(entry, fallback)).toBe(fallback);
  });

  it('returns entry.cap as-is for a link-kind entry (already parsed)', () => {
    const cap = { scope: { paths: ['spaces/sp1/**'] } };
    const entry = { kind: 'link' as const, cap, key: 'k', write: false };
    expect(resolveMemberCap(entry, fallback)).toBe(cap);
  });

  it('returns fallback when entry is null', () => {
    expect(resolveMemberCap(null, fallback)).toBe(fallback);
  });

  it('returns fallback when entry is undefined', () => {
    expect(resolveMemberCap(undefined, fallback)).toBe(fallback);
  });
});

// ── resolveMemberAuth ─────────────────────────────────────────────────────────

describe('resolveMemberAuth', () => {
  const fallbackCap = { fallbackCap: true };
  const fallbackKey = 'aabbcc_fallback_key';

  it('member-kind: returns parsed cap + fallback sign key', () => {
    const cap = { scope: { paths: ['spaces/sp1/**'] } };
    const entry = { kind: 'member' as const, cap: JSON.stringify(cap) };
    expect(resolveMemberAuth(entry, fallbackCap, fallbackKey)).toEqual({
      cap,
      signKey: fallbackKey,
    });
  });

  it('member-kind: corrupt JSON falls back to fallbackCap + fallback sign key', () => {
    const entry = { kind: 'member' as const, cap: '{bad json' };
    expect(resolveMemberAuth(entry, fallbackCap, fallbackKey)).toEqual({
      cap: fallbackCap,
      signKey: fallbackKey,
    });
  });

  it('link-kind: returns entry.cap and entry.key (NOT the fallback key)', () => {
    const cap = { scope: { paths: ['spaces/sp1/**'] } };
    const linkKey = 'link_ephemeral_key_hex';
    const entry = { kind: 'link' as const, cap, key: linkKey, write: false };
    const auth = resolveMemberAuth(entry, fallbackCap, fallbackKey);
    expect(auth.cap).toBe(cap);
    // Critical: the link signing key, not the account fallback key
    expect(auth.signKey).toBe(linkKey);
    expect(auth.signKey).not.toBe(fallbackKey);
  });

  it('no entry: returns fallbackCap + fallback sign key', () => {
    expect(resolveMemberAuth(null, fallbackCap, fallbackKey)).toEqual({
      cap: fallbackCap,
      signKey: fallbackKey,
    });
    expect(resolveMemberAuth(undefined, fallbackCap, fallbackKey)).toEqual({
      cap: fallbackCap,
      signKey: fallbackKey,
    });
  });
});
