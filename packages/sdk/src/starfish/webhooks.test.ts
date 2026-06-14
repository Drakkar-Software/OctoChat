import { webcrypto } from 'node:crypto';

import { describe, it, expect, beforeAll } from 'vitest';
import { StarfishHttpError, type StarfishClient } from '@drakkar.software/starfish-client';

import {
  createWebhook,
  listWebhooks,
  removeWebhook,
  webhookTokenHash,
  deriveWebhookSignerPubHex,
  webhookUrl,
  WEBHOOK_TOKEN_HEADER,
  MAX_WEBHOOKS_PER_SPACE,
  type WebhooksDoc,
} from './webhooks';

beforeAll(() => {
  if (!globalThis.crypto) {
    // @ts-expect-error — provide WebCrypto under Node for digest/getRandomValues.
    globalThis.crypto = webcrypto;
  }
});

/** An in-memory StarfishClient stub backing a single registry doc keyed by path. */
function fakeClient(spaceId: string) {
  const store = new Map<string, { data: Record<string, unknown>; hash: string }>();
  let seq = 0;
  const client = {
    async pull(path: string) {
      const cleaned = path.replace(/^\/pull\//, '');
      const cur = store.get(cleaned);
      if (!cur) throw new StarfishHttpError(404, 'not found');
      return { data: cur.data, hash: cur.hash };
    },
    async push(path: string, data: Record<string, unknown>, baseHash: string | null) {
      const cleaned = path.replace(/^\/push\//, '');
      const cur = store.get(cleaned);
      if ((cur?.hash ?? null) !== (baseHash ?? null)) throw new StarfishHttpError(409, 'conflict');
      const hash = `h${++seq}`;
      store.set(cleaned, { data, hash });
      return { hash };
    },
  } as unknown as StarfishClient;
  // Registry lives at spaces/{spaceId}/_webhooks (no ownerId).
  const peek = (): WebhooksDoc | undefined =>
    store.get(`spaces/${spaceId}/_webhooks`)?.data as WebhooksDoc | undefined;
  return { client, peek };
}

const SPACE = 'space1';

describe('self-service webhook provisioning', () => {
  it('creates a webhook storing only the token HASH, returning the token once', async () => {
    const { client, peek } = fakeClient(SPACE);
    const created = await createWebhook(client, SPACE, { roomId: 'room1', label: 'CI' });

    expect(created.id).toMatch(/^wh-/);
    expect(created.token).toMatch(/^[0-9a-f]{64}$/); // 256-bit hex
    expect(created.tokenHeader).toBe(WEBHOOK_TOKEN_HEADER);

    const doc = peek()!;
    const entry = doc.hooks[created.id]!;
    // Raw token is NEVER persisted — only its hash. No signing PRIVATE key at rest.
    expect(JSON.stringify(doc)).not.toContain(created.token);
    expect(entry.tokenHash).toBe(await webhookTokenHash(created.token));
    expect(entry.roomId).toBe('room1');
    expect(entry.label).toBe('CI');
    // The per-webhook signing key is DERIVED from the token; only its public half is stored.
    expect(created.signerPubHex).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.signEdPubHex).toBe(created.signerPubHex);
    expect(entry.signEdPubHex).toBe(await deriveWebhookSignerPubHex(created.token));
  });

  it('lists webhooks without exposing any token, newest first', async () => {
    const { client } = fakeClient(SPACE);
    const a = await createWebhook(client, SPACE, { roomId: 'r1', label: 'first' });
    await new Promise((r) => setTimeout(r, 2)); // distinct createdAt (ms granularity)
    const b = await createWebhook(client, SPACE, { roomId: 'r2', label: 'second' });

    const list = await listWebhooks(client, SPACE);
    expect(list.map((w) => w.id)).toEqual([b.id, a.id]); // newest first
    expect(list.map((w) => w.label)).toEqual(['second', 'first']);
    expect(JSON.stringify(list)).not.toContain(a.token);
    expect(JSON.stringify(list)).not.toContain(b.token);
  });

  it('two webhooks get distinct ids and distinct tokens', async () => {
    const { client } = fakeClient(SPACE);
    const a = await createWebhook(client, SPACE, { roomId: 'r', label: 'x' });
    const b = await createWebhook(client, SPACE, { roomId: 'r', label: 'y' });
    expect(a.id).not.toBe(b.id);
    expect(a.token).not.toBe(b.token);
  });

  it('rejects creating beyond the per-space cap', async () => {
    const { client } = fakeClient(SPACE);
    for (let i = 0; i < MAX_WEBHOOKS_PER_SPACE; i++) {
      await createWebhook(client, SPACE, { roomId: 'r', label: `w${i}` });
    }
    await expect(createWebhook(client, SPACE, { roomId: 'r', label: 'over' })).rejects.toThrow(/limit reached/i);
  });

  it('revokes a webhook by id', async () => {
    const { client, peek } = fakeClient(SPACE);
    const a = await createWebhook(client, SPACE, { roomId: 'r', label: 'keep' });
    const b = await createWebhook(client, SPACE, { roomId: 'r', label: 'drop' });
    await removeWebhook(client, SPACE, b.id);

    const remaining = await listWebhooks(client, SPACE);
    expect(remaining.map((w) => w.id)).toEqual([a.id]);
    expect(peek()!.hooks[b.id]).toBeUndefined();
  });

  it('records the seal key for an E2EE webhook', async () => {
    const { client } = fakeClient(SPACE);
    const created = await createWebhook(client, SPACE, { roomId: 'r', label: 'sealed', sealKemPubHex: 'abcd' });
    const list = await listWebhooks(client, SPACE);
    expect(list.find((w) => w.id === created.id)?.sealed).toBe(true);
  });

  it('builds the paste-able webhook URL (no ownerId segment)', () => {
    // Route is POST /webhook/:spaceId/:webhookId — ownerId removed in 0.4.3.
    expect(webhookUrl('https://sync.example.com/', SPACE, 'wh-abc')).toBe(
      'https://sync.example.com/webhook/space1/wh-abc',
    );
  });
});
