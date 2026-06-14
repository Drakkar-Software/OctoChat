import { describe, expect, it } from 'vitest';
import { resolveMemberAuth } from './space-cap';

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
