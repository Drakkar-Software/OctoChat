import { describe, expect, it } from 'vitest';
import { ConflictError } from '@drakkar.software/starfish-client';
import type { StarfishClient } from '@drakkar.software/starfish-client';

import { updateObjectIndex } from './object-index';
import type { ObjectNode } from '../domain/types';

// updateObjectIndex is the shared RMW loop both the PUBLIC (plaintext) and PRIVATE (encrypted)
// object-index writers route through — so these cases pin the conflict-retry + the
// encryptor-or-null branch ONCE, for both. A tiny in-memory client stands in for the server.
const node = (id: string): ObjectNode => ({ id, type: 'room', title: id }) as unknown as ObjectNode;

describe('updateObjectIndex (shared public/private index RMW)', () => {
  it('reads, applies the mutator, and pushes the merged objects under the read hash', async () => {
    const pushes: { body: unknown; hash: string | null }[] = [];
    const client = {
      async pull() {
        return { data: { objects: [node('a')] }, hash: 'h0' };
      },
      async push(_p: string, body: unknown, hash: string | null) {
        pushes.push({ body, hash });
      },
    } as unknown as StarfishClient;

    await updateObjectIndex(client, null, 'pull', 'push', (nodes) => [...nodes, node('b')]);

    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toEqual({ body: { objects: [node('a'), node('b')] }, hash: 'h0' });
  });

  it('a null mutator return is a no-op — never pushes', async () => {
    let pushed = false;
    const client = {
      async pull() {
        return { data: { objects: [node('a')] }, hash: 'h0' };
      },
      async push() {
        pushed = true;
      },
    } as unknown as StarfishClient;

    await updateObjectIndex(client, null, 'pull', 'push', () => null);
    expect(pushed).toBe(false);
  });

  it('on a 409 it re-reads FRESH state and re-runs the mutator — never clobbering a sibling node', async () => {
    // First push 409s after a sibling concurrently appended; the retry must see the sibling
    // (fresh pull) and the mutator appends onto it, so the final doc has BOTH nodes.
    let store: { objects: ObjectNode[] } = { objects: [node('a')] };
    let attempt = 0;
    const client = {
      async pull() {
        return { data: store, hash: `h${attempt}` };
      },
      async push(_p: string, body: { objects: ObjectNode[] }) {
        if (attempt === 0) {
          attempt = 1;
          store = { objects: [node('a'), node('sibling')] }; // concurrent writer moved the hash
          throw new ConflictError();
        }
        store = body;
      },
    } as unknown as StarfishClient;

    await updateObjectIndex(client, null, 'pull', 'push', (nodes) => [...nodes, node('mine')]);

    expect(store.objects.map((n) => n.id)).toEqual(['a', 'sibling', 'mine']);
  });

  it('with an encryptor it decrypts the pulled doc and encrypts the pushed body (private index)', async () => {
    // A fake symmetric "encryptor": encrypt wraps under `_sealed`, decrypt unwraps it. Proves
    // the loop runs the mutator on PLAINTEXT nodes and ships the SEALED body to the server.
    const enc = {
      async encrypt(o: Record<string, unknown>) {
        return { _sealed: JSON.stringify(o) };
      },
      async decrypt(d: Record<string, unknown>) {
        return JSON.parse((d as { _sealed: string })._sealed);
      },
    } as never;

    let seenByMutator: ObjectNode[] | null = null;
    const pushes: unknown[] = [];
    const sealed = { _sealed: JSON.stringify({ objects: [node('a')] }) };
    const client = {
      async pull() {
        return { data: sealed, hash: 'h0' };
      },
      async push(_p: string, body: unknown) {
        pushes.push(body);
      },
    } as unknown as StarfishClient;

    await updateObjectIndex(client, enc, 'pull', 'push', (nodes) => {
      seenByMutator = nodes;
      return [...nodes, node('b')];
    });

    expect(seenByMutator).toEqual([node('a')]); // mutator saw decrypted plaintext
    expect(pushes).toEqual([{ _sealed: JSON.stringify({ objects: [node('a'), node('b')] }) }]); // sealed body
  });
});
