/**
 * Tests for uploadAttachment / loadAttachment, covering both the E2EE path (enc present)
 * and the plaintext path (enc = null). Guards against the regression where `enc = null`
 * caused a silent no-op in the app's `uploadAttachment` / `loadAttachment` wrappers.
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

type FakeBlob = { path: string; data: Uint8Array };
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
  it('seals the blob before storing (stored bytes differ from plaintext)', async () => {
    const client = makeFakeClient();
    const ref: AttachmentRef = await uploadAttachment(client as never, fakeSealer, 'room-1', BYTES, 'test.png', 'image/png');
    expect(fakeSealer.sealBytes).toHaveBeenCalledOnce();
    // The bytes on the server must be the SEALED form, not the plaintext.
    const storedPath = [...client.blobs.keys()][0]!;
    expect(client.blobs.get(storedPath)).toEqual(SEALED);
    expect(ref.name).toBe('test.png');
    expect(ref.mime).toBe('image/png');
    expect(ref.size).toBe(5);
    expect(ref.kind).toBe('image');
  });

  it('returns the original plaintext on loadAttachment (round-trip)', async () => {
    const client = makeFakeClient();
    const ref = await uploadAttachment(client as never, fakeSealer, 'room-1', BYTES, 'test.txt', 'text/plain');
    clearAttachmentCache(); // force a cold load
    const loaded = await loadAttachment(client as never, fakeSealer, 'room-1', ref);
    expect(loaded).toEqual(BYTES);
    expect(fakeSealer.openBytes).toHaveBeenCalledOnce();
  });

  it('loadAttachment serves from in-memory cache on the second call (no network)', async () => {
    const client = makeFakeClient();
    const ref = await uploadAttachment(client as never, fakeSealer, 'room-1', BYTES, 'a.png', 'image/png');
    // First load — primes the cache (upload already primed it in fact, so openBytes won't run).
    const first = await loadAttachment(client as never, fakeSealer, 'room-1', ref);
    const second = await loadAttachment(client as never, fakeSealer, 'room-1', ref);
    expect(first).toEqual(BYTES);
    expect(second).toEqual(BYTES);
    // pullBlob not called for the second load (in-memory cache hit).
    expect(client.pullBlob).not.toHaveBeenCalled();
  });

  it('loadAttachment falls back to KV persistence on cache miss (no network pull)', async () => {
    const client = makeFakeClient();
    const ref = await uploadAttachment(client as never, fakeSealer, 'room-2', BYTES, 'b.txt', 'text/plain');
    clearAttachmentCache(); // evict the sender's own cache entry
    const loaded = await loadAttachment(client as never, fakeSealer, 'room-2', ref);
    // KV path served it — pullBlob should NOT have been called.
    expect(client.pullBlob).not.toHaveBeenCalled();
    expect(loaded).toEqual(BYTES);
  });
});

// ── uploadAttachment — plaintext (enc = null) ──────────────────────────────────

describe('uploadAttachment — plaintext (enc = null)', () => {
  it('does NOT seal the blob (stored bytes are the raw plaintext)', async () => {
    const client = makeFakeClient();
    const ref: AttachmentRef = await uploadAttachment(client as never, null, 'room-pub', BYTES, 'file.pdf', 'application/pdf');
    expect(fakeSealer.sealBytes).not.toHaveBeenCalled();
    // The bytes on the server must be the original plaintext.
    const storedPath = [...client.blobs.keys()][0]!;
    expect(client.blobs.get(storedPath)).toEqual(BYTES);
    expect(ref.name).toBe('file.pdf');
    expect(ref.mime).toBe('application/pdf');
    expect(ref.size).toBe(5);
    expect(ref.kind).toBe('file');
  });

  it('returns the original bytes on loadAttachment (round-trip, no open call)', async () => {
    const client = makeFakeClient();
    const ref = await uploadAttachment(client as never, null, 'room-pub', BYTES, 'img.jpg', 'image/jpeg');
    clearAttachmentCache();
    const loaded = await loadAttachment(client as never, null, 'room-pub', ref);
    expect(loaded).toEqual(BYTES);
    expect(fakeSealer.openBytes).not.toHaveBeenCalled();
  });

  it('plaintext load from network (cache + KV miss) passes bytes through without decrypting', async () => {
    // Simulate: some other device uploaded a plaintext blob. We have neither the
    // in-memory cache nor the KV entry — must pull from the server.
    const client = makeFakeClient();
    // The pull path is /pull/spaces/<spaceId>/attachments/<roomId>/<blobId>.
    // spaceIdFromRoomId('room-pub') = 'room-pub' (2-segment id), so:
    const fakePullPath = '/pull/spaces/room-pub/attachments/room-pub/blob-x';
    client.blobs.set(fakePullPath, BYTES);
    // Build a fake ref that points to this blob.
    const ref: AttachmentRef = { blobId: 'blob-x', name: 'img.jpg', mime: 'image/jpeg', size: 5, kind: 'image' };
    // Pull via loadAttachment with no enc and a cold cache.
    const loaded = await loadAttachment(client as never, null, 'room-pub', ref);
    expect(client.pullBlob).toHaveBeenCalledOnce();
    expect(loaded).toEqual(BYTES);
    expect(fakeSealer.openBytes).not.toHaveBeenCalled();
  });
});

// ── Cross-path: sealed blobs cannot be served as plaintext and vice versa ─────

describe('enc path integrity', () => {
  it('loading a sealed blob with enc=null returns the sealed (garbled) bytes — not plaintext', async () => {
    // This tests that the enc=null path really is raw passthrough: if you accidentally
    // load with enc=null what was uploaded with enc=fakeSealer, you get garbled bytes.
    const client = makeFakeClient();
    const ref = await uploadAttachment(client as never, fakeSealer, 'room-x', BYTES, 'f.bin', 'application/octet-stream');
    clearAttachmentCache();
    const wrong = await loadAttachment(client as never, null, 'room-x', ref);
    // The KV stored the SEALED form; loading without dec gives us the sealed form — NOT BYTES.
    expect(wrong).toEqual(SEALED);
  });
});
