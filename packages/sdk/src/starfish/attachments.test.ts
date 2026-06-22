/**
 * Tests for uploadAttachment / loadAttachment (OctoChat wrapper over createObjectBlobStore).
 * Blobs are keyed by SPACE (not room) and pushed to the `objblob` collection
 * (`spaces/{spaceId}/objects/blobs/{blobId}`). Guards against the regression where
 * `enc = null` caused a silent no-op, and verifies the cache/persist behaviour.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { configureKv } from '../config/adapters';
import { attachmentKind, clearAttachmentCache, loadAttachment, uploadAttachment, type ByteSealer } from './attachments';
import type { AttachmentRef } from './attachments';

// ── In-memory KV ──────────────────────────────────────────────────────────────

let store: Map<string, string>;

beforeEach(() => {
  store = new Map<string, string>();
  configureKv({
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => void store.set(k, v),
    remove: async (k) => void store.delete(k),
  });
  clearAttachmentCache();
  vi.clearAllMocks();
});

// ── Fake StarfishClient ────────────────────────────────────────────────────────

function makeFakeClient() {
  const blobs = new Map<string, Uint8Array>();
  return {
    pushBlob: vi.fn(async (path: string, data: Uint8Array) => void blobs.set(path, data)),
    pullBlob: vi.fn(async (path: string) => {
      const d = blobs.get(path);
      if (!d) throw new Error(`blob not found: ${path}`);
      return { data: d } as unknown as { data: Uint8Array };
    }),
    blobs,
  };
}

// ── Fake ByteSealer ───────────────────────────────────────────────────────────
// XOR with 0xFF so seal(seal(x)) === x and seal(x) !== x for non-zero bytes.

const fakeSealer: ByteSealer = {
  sealBytes: vi.fn(async (bytes: Uint8Array, _aad?: string) => {
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) out[i] = bytes[i]! ^ 0xff;
    return out;
  }),
  openBytes: vi.fn(async (bytes: Uint8Array, _aad?: string) => {
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) out[i] = bytes[i]! ^ 0xff;
    return out;
  }),
};

const BYTES = new Uint8Array([1, 2, 3, 4, 5]);
const SEALED = new Uint8Array([1 ^ 0xff, 2 ^ 0xff, 3 ^ 0xff, 4 ^ 0xff, 5 ^ 0xff]);

// ── attachmentKind ─────────────────────────────────────────────────────────────

describe('attachmentKind', () => {
  it('image/* MIME types resolve to "image"', () => {
    expect(attachmentKind('image/png')).toBe('image');
    expect(attachmentKind('image/jpeg')).toBe('image');
    expect(attachmentKind('image/gif')).toBe('image');
    expect(attachmentKind('image/webp')).toBe('image');
  });

  it('non-image MIME types resolve to "file"', () => {
    expect(attachmentKind('application/pdf')).toBe('file');
    expect(attachmentKind('text/plain')).toBe('file');
    expect(attachmentKind('video/mp4')).toBe('file');
    expect(attachmentKind('audio/mpeg')).toBe('file');
  });
});

// ── uploadAttachment — encrypted (enc present) ─────────────────────────────────

describe('uploadAttachment — encrypted (enc != null)', () => {
  it('seals the blob before storing, pushes to objblob path (spaces/{spaceId}/objects/blobs/{blobId})', async () => {
    const client = makeFakeClient();
    const ref: AttachmentRef = await uploadAttachment(client as never, fakeSealer, 'sp-1', BYTES, 'test.png', 'image/png');
    expect(fakeSealer.sealBytes).toHaveBeenCalledOnce();
    // The bytes on the server must be the SEALED form, not the plaintext.
    const storedPath = [...client.blobs.keys()][0]!;
    expect(storedPath).toContain('sp-1/objects/blobs/');
    expect(client.blobs.get(storedPath)).toEqual(SEALED);
    expect(ref.name).toBe('test.png');
    expect(ref.mime).toBe('image/png');
    expect(ref.size).toBe(5);
    expect(ref.kind).toBe('image');
  });

  it('returns the original plaintext on loadAttachment (round-trip)', async () => {
    const client = makeFakeClient();
    const ref = await uploadAttachment(client as never, fakeSealer, 'sp-1', BYTES, 'test.txt', 'text/plain');
    clearAttachmentCache(); // force a cold load
    // expose push path as pull path
    const pushPath = [...client.blobs.keys()][0]!;
    client.blobs.set(pushPath.replace('/push/', '/pull/'), client.blobs.get(pushPath)!);
    const loaded = await loadAttachment(client as never, fakeSealer, 'sp-1', ref);
    expect(loaded).toEqual(BYTES);
    expect(fakeSealer.openBytes).toHaveBeenCalledOnce();
  });

  it('loadAttachment serves from in-memory cache on the second call (no network)', async () => {
    const client = makeFakeClient();
    const ref = await uploadAttachment(client as never, fakeSealer, 'sp-1', BYTES, 'a.png', 'image/png');
    // Upload already primed the cache, so no pull should occur.
    const first = await loadAttachment(client as never, fakeSealer, 'sp-1', ref);
    const second = await loadAttachment(client as never, fakeSealer, 'sp-1', ref);
    expect(first).toEqual(BYTES);
    expect(second).toEqual(BYTES);
    expect(client.pullBlob).not.toHaveBeenCalled();
  });

  it('loadAttachment falls back to KV persistence on cache miss (no network pull)', async () => {
    const client = makeFakeClient();
    const ref = await uploadAttachment(client as never, fakeSealer, 'sp-2', BYTES, 'b.txt', 'text/plain');
    clearAttachmentCache(); // evict the sender's own cache entry
    const loaded = await loadAttachment(client as never, fakeSealer, 'sp-2', ref);
    // KV path served it — pullBlob should NOT have been called.
    expect(client.pullBlob).not.toHaveBeenCalled();
    expect(loaded).toEqual(BYTES);
  });
});

// ── uploadAttachment — plaintext (enc = null) ──────────────────────────────────

describe('uploadAttachment — plaintext (enc = null)', () => {
  it('does NOT seal the blob (stored bytes are the raw plaintext)', async () => {
    const client = makeFakeClient();
    const ref: AttachmentRef = await uploadAttachment(client as never, null, 'sp-pub', BYTES, 'file.pdf', 'application/pdf');
    expect(fakeSealer.sealBytes).not.toHaveBeenCalled();
    const storedPath = [...client.blobs.keys()][0]!;
    expect(storedPath).toContain('sp-pub/objects/blobs/');
    expect(client.blobs.get(storedPath)).toEqual(BYTES);
    expect(ref.name).toBe('file.pdf');
    expect(ref.mime).toBe('application/pdf');
    expect(ref.size).toBe(5);
    expect(ref.kind).toBe('file');
  });

  it('returns the original bytes on loadAttachment (round-trip, no open call)', async () => {
    const client = makeFakeClient();
    const ref = await uploadAttachment(client as never, null, 'sp-pub', BYTES, 'img.jpg', 'image/jpeg');
    clearAttachmentCache();
    const pushPath = [...client.blobs.keys()][0]!;
    client.blobs.set(pushPath.replace('/push/', '/pull/'), client.blobs.get(pushPath)!);
    const loaded = await loadAttachment(client as never, null, 'sp-pub', ref);
    expect(loaded).toEqual(BYTES);
    expect(fakeSealer.openBytes).not.toHaveBeenCalled();
  });

  it('plaintext load from network (cache + KV miss) passes bytes through without decrypting', async () => {
    // Simulate: some other device uploaded a plaintext blob. We have neither the
    // in-memory cache nor the KV entry — must pull from the server.
    const client = makeFakeClient();
    // objblob pull path: /pull/spaces/{spaceId}/objects/blobs/{blobId}
    const fakePullPath = '/pull/spaces/sp-pub/objects/blobs/blob-x';
    client.blobs.set(fakePullPath, BYTES);
    const ref: AttachmentRef = { blobId: 'blob-x', name: 'img.jpg', mime: 'image/jpeg', size: 5, kind: 'image' };
    const loaded = await loadAttachment(client as never, null, 'sp-pub', ref);
    expect(client.pullBlob).toHaveBeenCalledOnce();
    expect(loaded).toEqual(BYTES);
    expect(fakeSealer.openBytes).not.toHaveBeenCalled();
  });
});

// ── Node-scoped attachments (scope: 'node') ────────────────────────────────────

describe('uploadAttachment with nodeId — node-scoped (objnodeblob)', () => {
  it('stores under the node prefix and sets scope: "node" on the ref', async () => {
    const client = makeFakeClient();
    const ref = await uploadAttachment(client as never, fakeSealer, 'sp-n', BYTES, 'file.pdf', 'application/pdf', 'node-1');
    const storedPath = [...client.blobs.keys()][0]!;
    expect(storedPath).toContain('sp-n/objects/n/node-1/blobs/');
    expect(storedPath).not.toContain('/objects/blobs/');
    expect(ref.scope).toBe('node');
    expect(ref.kind).toBe('file');
  });

  it('round-trip: node-scoped upload + load returns original plaintext', async () => {
    const client = makeFakeClient();
    const ref = await uploadAttachment(client as never, fakeSealer, 'sp-n', BYTES, 'f.bin', 'application/octet-stream', 'node-2');
    clearAttachmentCache();
    const pushPath = [...client.blobs.keys()][0]!;
    client.blobs.set(pushPath.replace('/push/', '/pull/'), client.blobs.get(pushPath)!);
    const loaded = await loadAttachment(client as never, fakeSealer, 'sp-n', ref, 'node-2');
    expect(loaded).toEqual(BYTES);
  });

  it('loadAttachment routes to node path when ref.scope === "node", space path otherwise', async () => {
    const client = makeFakeClient();
    const nodeRef: AttachmentRef = { blobId: 'bbb1', name: 'f.bin', mime: 'application/octet-stream', size: 5, kind: 'file', scope: 'node' };
    const spaceRef: AttachmentRef = { blobId: 'bbb2', name: 'f.bin', mime: 'application/octet-stream', size: 5, kind: 'file' };
    const nodePullPath = '/pull/spaces/sp-r/objects/n/node-r/blobs/bbb1';
    const spacePullPath = '/pull/spaces/sp-r/objects/blobs/bbb2';
    client.blobs.set(nodePullPath, BYTES);
    client.blobs.set(spacePullPath, BYTES);

    const fromNode = await loadAttachment(client as never, null, 'sp-r', nodeRef, 'node-r');
    const fromSpace = await loadAttachment(client as never, null, 'sp-r', spaceRef);
    expect(fromNode).toEqual(BYTES);
    expect(fromSpace).toEqual(BYTES);
    const calls = vi.mocked(client.pullBlob).mock.calls.map(([p]) => p);
    expect(calls.some((p) => p.includes('/objects/n/node-r/blobs/'))).toBe(true);
    expect(calls.some((p) => p.includes('/objects/blobs/'))).toBe(true);
  });

  it('legacy ref without scope always routes to space-level path even with nodeId arg', async () => {
    const client = makeFakeClient();
    const legacyRef: AttachmentRef = { blobId: 'leg1', name: 'old.bin', mime: 'application/octet-stream', size: 5, kind: 'file' };
    const spacePullPath = '/pull/spaces/sp-leg/objects/blobs/leg1';
    client.blobs.set(spacePullPath, BYTES);
    const loaded = await loadAttachment(client as never, null, 'sp-leg', legacyRef, 'some-node');
    expect(loaded).toEqual(BYTES);
    const [pullPath] = vi.mocked(client.pullBlob).mock.calls[0]!;
    expect(pullPath).toContain('/objects/blobs/');
    expect(pullPath).not.toContain('/objects/n/');
  });
});

// ── Cross-path: sealed blobs cannot be served as plaintext and vice versa ─────

describe('enc path integrity', () => {
  it('loading a sealed blob with enc=null returns the sealed (garbled) bytes — not plaintext', async () => {
    const client = makeFakeClient();
    const ref = await uploadAttachment(client as never, fakeSealer, 'sp-x', BYTES, 'f.bin', 'application/octet-stream');
    clearAttachmentCache();
    const wrong = await loadAttachment(client as never, null, 'sp-x', ref);
    // The KV stored the SEALED form; loading without dec gives us the sealed form — NOT BYTES.
    expect(wrong).toEqual(SEALED);
  });
});
