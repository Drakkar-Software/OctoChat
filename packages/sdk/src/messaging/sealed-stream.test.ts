import { webcrypto } from 'node:crypto';

import { describe, expect, it, beforeAll } from 'vitest';
import { configurePlatform, ed25519Suite } from '@drakkar.software/starfish-protocol';
import { ed25519 } from '@noble/curves/ed25519.js';
import { seal } from '@drakkar.software/starfish-keyring';
import type { AppendElement } from '@drakkar.software/starfish-client';

import { fanOut, type StreamEnvelope } from './stream-log';
import {
  isSealedElement,
  sealStreamElement,
  openSealedStreamElement,
  openSealedItems,
} from './sealed-stream';

beforeAll(() => {
  configurePlatform({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    crypto: webcrypto as any,
    base64: {
      encode: (data) => Buffer.from(data).toString('base64'),
      decode: (str) => new Uint8Array(Buffer.from(str, 'base64')),
    },
  });
});

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
function genSigner() {
  const priv = ed25519.utils.randomSecretKey();
  return { edPrivHex: hex(priv), edPubHex: hex(ed25519.getPublicKey(priv)) };
}

// The webhook's signing identity (sealer) and the space write keypair.
const webhook = genSigner();
const msg = (id: string, text: string): StreamEnvelope => ({ t: 'msg', e: { id, authorId: 'webhook', ts: 0, text } });

describe('sealed-stream', () => {
  it('round-trips an envelope sealed to the space write key', async () => {
    const space = ed25519Suite.generateKemKeypair();
    const blob = await sealStreamElement(msg('m1', 'hello'), space.pubHex, webhook);
    expect(isSealedElement(blob)).toBe(true);
    const opened = await openSealedStreamElement(blob, space.privHex);
    expect(opened).toEqual(msg('m1', 'hello'));
  });

  it('on-wire body does not contain plaintext — E2EE is strictly client-side', async () => {
    const space = ed25519Suite.generateKemKeypair();
    const blob = await sealStreamElement(msg('m1', 'secret-payload'), space.pubHex, webhook);
    // The blob handed to the transport must NOT expose the plaintext message.
    // If it did, the server (which stores the raw blob) would hold readable content.
    const wire = JSON.stringify(blob);
    expect(wire).not.toContain('secret-payload');
    expect(wire).not.toContain('msg');
  });

  it('opens what the server produced (raw seal of the JSON envelope)', async () => {
    // Mirrors apps/server/webhook.ts: seal(JSON.stringify(element), pub, sealer).
    const space = ed25519Suite.generateKemKeypair();
    const blob = await seal(JSON.stringify(msg('m2', 'from server')), space.pubHex, webhook);
    const opened = await openSealedStreamElement(blob as never, space.privHex, { requireSealer: webhook.edPubHex });
    expect(opened).toEqual(msg('m2', 'from server'));
  });

  it('openSealedItems folds a mix of sealed and plaintext elements', async () => {
    const space = ed25519Suite.generateKemKeypair();
    const sealedBlob = await sealStreamElement(msg('m1', 'sealed'), space.pubHex, webhook);
    const items: AppendElement[] = [
      { ts: 10, data: sealedBlob as unknown as Record<string, unknown> },
      { ts: 11, data: msg('m2', 'plain') as unknown as Record<string, unknown> }, // plaintext passes through
    ];
    const opened = await openSealedItems(items, space.privHex, { requireSealer: webhook.edPubHex });
    const folded = fanOut(opened);
    expect(folded.messages.map((m) => [m.id, m.text])).toEqual([
      ['m1', 'sealed'],
      ['m2', 'plain'],
    ]);
    // ts stamped from the append envelope when the payload carried none.
    expect(folded.messages[0]?.ts).toBe(10);
  });

  it('skips (does not throw on) an element that cannot be opened', async () => {
    const space = ed25519Suite.generateKemKeypair();
    const other = ed25519Suite.generateKemKeypair();
    const sealedBlob = await sealStreamElement(msg('m1', 'secret'), space.pubHex, webhook);
    const items: AppendElement[] = [{ ts: 10, data: sealedBlob as unknown as Record<string, unknown> }];

    // Wrong private key → the element is dropped, not surfaced.
    const wrongKey = await openSealedItems(items, other.privHex, { requireSealer: webhook.edPubHex });
    expect(fanOut(wrongKey).messages).toHaveLength(0);

    // Wrong required sealer → also dropped.
    const impostor = genSigner();
    const wrongSealer = await openSealedItems(items, space.privHex, { requireSealer: impostor.edPubHex });
    expect(fanOut(wrongSealer).messages).toHaveLength(0);
  });

  it('isSealedElement distinguishes blobs from plaintext envelopes', () => {
    expect(isSealedElement(msg('m', 'x'))).toBe(false);
    expect(isSealedElement(null)).toBe(false);
    expect(isSealedElement({ entry: {}, ct: 'abc' })).toBe(true);
  });
});
