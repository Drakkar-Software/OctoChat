import { afterEach, describe, expect, it } from 'vitest';

import { configureOctoChat, getSyncBase, getSyncNamespace, getSyncPrefix } from './config';

// Reset module-level state between tests by reconfiguring to a known baseline.
afterEach(() => {
  configureOctoChat({ syncBase: 'http://reset' });
});

describe('configureOctoChat', () => {
  it('exposes syncBase verbatim', () => {
    configureOctoChat({ syncBase: 'https://dev-sync.example.com/sync' });
    expect(getSyncBase()).toBe('https://dev-sync.example.com/sync');
  });

  it('builds the correct /v1/<namespace> prefix when syncNamespace is set', () => {
    configureOctoChat({ syncBase: 'https://dev-sync.example.com/sync', syncNamespace: 'octochat' });
    expect(getSyncNamespace()).toBe('octochat');
    expect(getSyncPrefix()).toBe('/v1/octochat');
  });

  it('produces an empty prefix when syncNamespace is not set (local server)', () => {
    configureOctoChat({ syncBase: 'http://localhost:8787' });
    expect(getSyncNamespace()).toBeUndefined();
    expect(getSyncPrefix()).toBe('');
  });

  it('throws on the common "namespace" typo when syncNamespace is absent', () => {
    // TypeScript's excess-property check is bypassed by a conditional spread such as
    // `...(ns ? { namespace: ns } : {})`, so we enforce the correct key at runtime.
    expect(() =>
      configureOctoChat({ syncBase: 'https://x/sync', ...({ namespace: 'octochat' } as object) }),
    ).toThrow(/did you mean "syncNamespace"/);
  });

  it('does not throw when both "namespace" and syncNamespace are present (user set both)', () => {
    // If the caller set syncNamespace correctly AND also has a stray namespace key,
    // we trust syncNamespace and let the config through.
    expect(() =>
      configureOctoChat({
        syncBase: 'https://x/sync',
        syncNamespace: 'octochat',
        ...({ namespace: 'other' } as object),
      }),
    ).not.toThrow();
    expect(getSyncNamespace()).toBe('octochat');
  });

  it('rejects a syncNamespace with path separators', () => {
    expect(() =>
      configureOctoChat({ syncBase: 'https://x/sync', syncNamespace: 'my/ns' }),
    ).toThrow(/bare name/);
  });
});
