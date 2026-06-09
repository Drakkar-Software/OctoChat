import { webcrypto } from "node:crypto";

import { describe, it, expect, beforeAll } from "vitest";
import { configurePlatform, ed25519Suite } from "@drakkar.software/starfish-protocol";
import { MemoryObjectStore } from "@drakkar.software/starfish-server";
import { unseal } from "@drakkar.software/starfish-keyring";
import type { Queue } from "@drakkar.software/starfish-queuing";
import { ed25519 } from "@noble/curves/ed25519.js";

import { createWebhookRoute } from "./webhook.js";

beforeAll(() => {
  configurePlatform({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    crypto: webcrypto as any,
    base64: {
      encode: (data) => Buffer.from(data).toString("base64"),
      decode: (str) => new Uint8Array(Buffer.from(str, "base64")),
    },
  });
});

const ENC = new TextEncoder();
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function sha256Hex(input: string): Promise<string> {
  return hex(new Uint8Array(await webcrypto.subtle.digest("SHA-256", ENC.encode(input))));
}

// Mirror of the server/SDK derivation: the signing key comes from the token.
const SIGN_DOMAIN = "octochat-webhook-sign\n";
async function deriveSignerPub(token: string): Promise<string> {
  const seed = new Uint8Array(await webcrypto.subtle.digest("SHA-256", ENC.encode(SIGN_DOMAIN + token)));
  return hex(ed25519.getPublicKey(seed));
}

const OWNER = "owner1";
const SPACE = "space1";
const ROOM = "room1";
const WEBHOOK = "wh-abc";
const DOC_KEY = `pubspaces/${OWNER}/${SPACE}/streams/${ROOM}`;
const REGISTRY_KEY = `pubspaces/${OWNER}/${SPACE}/_webhooks`;

/** Seed a webhook registry doc into the store, as the sync router would persist it. */
async function seedRegistry(store: MemoryObjectStore, token: string, extra: Record<string, unknown> = {}) {
  const entry = {
    tokenHash: await sha256Hex(token),
    roomId: ROOM,
    label: "CI",
    createdAt: 1,
    signEdPubHex: await deriveSignerPub(token),
    ...extra,
  };
  const wrapper = { v: 1, data: { v: 1, hooks: { [WEBHOOK]: entry } }, ts: 1, hash: "seed" };
  await store.put(REGISTRY_KEY, JSON.stringify(wrapper), { contentType: "application/json" });
}

function makeFixture() {
  const store = new MemoryObjectStore(new Map());
  const published: Array<{ subject: string; payload: Uint8Array }> = [];
  const queue: Queue = {
    async publish(subject, payload) {
      published.push({ subject, payload });
    },
  };
  const app = createWebhookRoute({ store, queue });
  return { app, store, published };
}

async function post(
  app: ReturnType<typeof createWebhookRoute>,
  path: string,
  token: string | null,
  body: unknown,
  opts: { rawOverride?: string } = {},
) {
  const raw = opts.rawOverride ?? JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["x-webhook-token"] = token;
  return app.request(`/webhook/${path}`, { method: "POST", headers, body: raw });
}

async function storedElement(store: MemoryObjectStore): Promise<{ ts: number; data: Record<string, unknown>; authorPubkey?: string }> {
  const raw = await store.getString(DOC_KEY);
  const doc = JSON.parse(raw!) as { data: { items: Array<{ ts: number; data: Record<string, unknown>; authorPubkey?: string }> } };
  return doc.data.items[doc.data.items.length - 1]!;
}

const TOKEN = "f00dcafedeadbeef".repeat(4); // arbitrary 64-char token

describe("createWebhookRoute (self-service, token-derived signing)", () => {
  it("appends a message; the author proof is signed with the key DERIVED from the token", async () => {
    const { app, store, published } = makeFixture();
    await seedRegistry(store, TOKEN);

    const res = await post(app, `${OWNER}/${SPACE}/${WEBHOOK}`, TOKEN, { text: "build passed", author: "ci-bot" });
    expect(res.status).toBe(200);

    const el = await storedElement(store);
    expect(el.data).toMatchObject({ t: "msg", e: { authorId: "webhook:ci-bot", text: "build passed" } });
    // No platform key: the stored author pubkey equals the key derived from the token.
    expect(el.authorPubkey).toBe(await deriveSignerPub(TOKEN));

    expect(published).toHaveLength(1);
    expect(published[0]!.subject).toBe("octochat.chat.changed");
    const msg = JSON.parse(new TextDecoder().decode(published[0]!.payload));
    expect(msg.params).toEqual({ ownerId: OWNER, spaceId: SPACE, roomId: ROOM });
  });

  it("falls back to the webhook id as author when payload omits author", async () => {
    const { app, store } = makeFixture();
    await seedRegistry(store, TOKEN);
    await post(app, `${OWNER}/${SPACE}/${WEBHOOK}`, TOKEN, { text: "hi" });
    expect((await storedElement(store)).data).toMatchObject({ e: { authorId: `webhook:${WEBHOOK}` } });
  });

  it("rejects a wrong token (401) and writes nothing", async () => {
    const { app, store, published } = makeFixture();
    await seedRegistry(store, TOKEN);
    const res = await post(app, `${OWNER}/${SPACE}/${WEBHOOK}`, "wrong-token", { text: "x" });
    expect(res.status).toBe(401);
    expect(await store.getString(DOC_KEY)).toBeNull();
    expect(published).toHaveLength(0);
  });

  it("rejects a missing token (401)", async () => {
    const { app, store } = makeFixture();
    await seedRegistry(store, TOKEN);
    expect((await post(app, `${OWNER}/${SPACE}/${WEBHOOK}`, null, { text: "x" })).status).toBe(401);
  });

  it("returns 404 for a webhook id absent from the registry", async () => {
    const { app, store } = makeFixture();
    await seedRegistry(store, TOKEN);
    expect((await post(app, `${OWNER}/${SPACE}/wh-nope`, TOKEN, { text: "x" })).status).toBe(404);
  });

  it("returns 404 when no registry exists for the space", async () => {
    const { app } = makeFixture();
    expect((await post(app, `${OWNER}/${SPACE}/${WEBHOOK}`, TOKEN, { text: "x" })).status).toBe(404);
  });

  it("rejects path-traversal segments (400) before any store read", async () => {
    const { app, store } = makeFixture();
    await seedRegistry(store, TOKEN);
    expect((await post(app, `..%2F..%2Fetc/${SPACE}/${WEBHOOK}`, TOKEN, { text: "x" })).status).toBe(400);
  });

  it("rejects a segment containing a dot (400) — keeps ids out of NATS subjects", async () => {
    const { app, store } = makeFixture();
    await seedRegistry(store, TOKEN);
    expect((await post(app, `own.er/${SPACE}/${WEBHOOK}`, TOKEN, { text: "x" })).status).toBe(400);
  });

  it("rejects missing text (400) and invalid JSON (400)", async () => {
    const { app, store } = makeFixture();
    await seedRegistry(store, TOKEN);
    expect((await post(app, `${OWNER}/${SPACE}/${WEBHOOK}`, TOKEN, { notText: "x" })).status).toBe(400);
    expect((await post(app, `${OWNER}/${SPACE}/${WEBHOOK}`, TOKEN, undefined, { rawOverride: "{bad" })).status).toBe(400);
  });

  it("Option B: a sealed webhook stores ciphertext a member re-opens, sealer == token-derived key", async () => {
    const space = ed25519Suite.generateKemKeypair();
    const { app, store } = makeFixture();
    await seedRegistry(store, TOKEN, { sealKemPubHex: space.pubHex });

    const res = await post(app, `${OWNER}/${SPACE}/${WEBHOOK}`, TOKEN, { text: "top secret", author: "ci-bot" });
    expect(res.status).toBe(200);

    const el = await storedElement(store);
    expect(el.data).toHaveProperty("entry");
    expect(JSON.stringify(el.data)).not.toContain("top secret");
    // The sealer the member pins is the webhook's token-derived public key.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opened = JSON.parse(
      new TextDecoder().decode(await unseal(el.data as any, space.privHex, { requireSealer: await deriveSignerPub(TOKEN) })),
    );
    expect(opened).toMatchObject({ t: "msg", e: { authorId: "webhook:ci-bot", text: "top secret" } });
  });
});
