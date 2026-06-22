/**
 * Shared test helper: builds a minimal but type-correct Session mock.
 * The new Session interface (starfish-spaces 0.25) added several required fields
 * (`layout`, `ownerEdPub`, `userIdFromEdPub`, etc.) that old mock sessions omit.
 * Import this from test files instead of hand-rolling incomplete mocks.
 */
import { defaultSpaceLayout } from '@drakkar.software/starfish-spaces';
import type { Session } from '@drakkar.software/starfish-spaces';
import type { StarfishClient } from '@drakkar.software/starfish-client';

/** A minimal StarfishClient stub — all methods are no-ops. */
export function mockClient(): StarfishClient {
  return {} as StarfishClient;
}

/** Build a full Session mock with all required fields. Override any field via `overrides`. */
export function makeMockSession(overrides: Partial<Session> = {}): Session {
  const keys = overrides.keys ?? {
    edPub: 'a'.repeat(64),
    edPriv: 'b'.repeat(64),
    kemPub: 'c'.repeat(64),
    kemPriv: 'd'.repeat(64),
  };
  const ownerEdPub = overrides.ownerEdPub ?? keys.edPub;

  return {
    userId: 'u-test',
    name: 'Test User',
    keys,
    contentCap: null,
    accountCap: null,
    contentClient: mockClient(),
    accountClient: mockClient(),
    spacesRegistryClient: mockClient(),
    spacesKeyringClient: mockClient(),
    fingerprint: 'AAAA · BBBB · CCCC',
    ownerEdPub,
    layout: defaultSpaceLayout,
    userIdFromEdPub: async (pub: string) => 'usr-' + pub.slice(0, 8),
    spaceIdPrefix: 'sp-',
    nodeIdPrefix: 'obj-',
    inboxAadNamespace: 'starfish:inbox:v1',
    kvKeyPrefix: 'starfish.spaceaccess.',
    baseUrl: 'http://localhost:8787',
    namespace: '',
    ...overrides,
  } as Session;
}
