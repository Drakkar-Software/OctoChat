/**
 * Encrypted attachment upload/download over a Starfish raw-blob collection.
 *
 * Bytes are sealed client-side with the room's keyring CEK (`sealBytes`), so the
 * server only ever stores opaque ciphertext (`application/octet-stream`). The
 * blob's storage path is bound into the seal's AAD, so a hostile server can't
 * relocate or swap one blob for another. The message document keeps only a small
 * {@link AttachmentRef}; the bytes live in the `attachments` collection.
 *
 * Cross-epoch caveat: a blob sealed at epoch N is readable only by recipients
 * who hold epoch N's CEK. A member added after a key rotation sees attachments
 * uploaded *after* they joined; re-sealing old blobs (re-download + re-upload)
 * is intentionally not done — same trade-off as message re-seal, costlier to fix.
 */
import { getBase64 } from '@drakkar.software/starfish-protocol';
import type { StarfishClient } from '@drakkar.software/starfish-client';

import { randomId } from '../ids';

import { kvGet, kvRemove, kvSet } from './kv';
import { attachmentName, attachmentPull, attachmentPush } from './paths';

/**
 * The byte-sealing surface of the keyring encryptor (`KeyringEncryptor`). The
 * room encryptor is typed as the protocol's narrower `Encryptor` at call sites,
 * so we name just the methods we need and the caller casts the runtime keyring
 * encryptor — which has them — to this.
 */
export interface ByteSealer {
  sealBytes(bytes: Uint8Array, aad?: string): Promise<Uint8Array>;
  openBytes(blob: Uint8Array, aad?: string): Promise<Uint8Array>;
}

/** Reference to an uploaded attachment, stored inside a message document. */
export interface AttachmentRef {
  blobId: string;
  name: string;
  mime: string;
  size: number;
  kind: 'image' | 'file';
}

/** Plaintext size cap per attachment (~10 MB); the collection allows ~11 MB sealed. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function randomBlobId(): string {
  // CSPRNG: the blob id is the storage-path leaf AND the seal AAD, so a
  // predictable/collidable id would allow a same-path overwrite (see `@/lib/ids`).
  return randomId();
}

/**
 * Session cache of decrypted attachment bytes, keyed by `${roomId}/${blobId}`.
 * A blob is immutable (its id is random per upload), so a cache hit can never be
 * stale. This spares the network pull + AES-GCM open every time an AttachmentView
 * re-mounts — switching rooms, opening a thread, the lightbox, a list re-render.
 *
 * In-memory only (never persisted): the bytes are plaintext, and writing them to
 * disk would defeat the at-rest encryption. Bounded by a byte budget with
 * oldest-first eviction so a long session can't grow without limit.
 */
const decryptedCache = new Map<string, Uint8Array>();
const CACHE_BUDGET_BYTES = 64 * 1024 * 1024;
let cacheBytes = 0;

function cacheKey(roomId: string, blobId: string): string {
  return `${roomId}/${blobId}`;
}

function cachePut(key: string, bytes: Uint8Array): void {
  const existing = decryptedCache.get(key);
  if (existing) cacheBytes -= existing.length;
  decryptedCache.set(key, bytes);
  cacheBytes += bytes.length;
  // Map preserves insertion order, so iteration evicts oldest first. Never drop
  // the entry we just added (a single oversized blob is kept on its own).
  for (const [k, v] of decryptedCache) {
    if (cacheBytes <= CACHE_BUDGET_BYTES) break;
    if (k === key) continue;
    decryptedCache.delete(k);
    cacheBytes -= v.length;
  }
}

/** Drop all decrypted plaintext bytes (on account switch — they belong to one identity). */
export function clearAttachmentCache(): void {
  decryptedCache.clear();
  cacheBytes = 0;
}

/**
 * Persistent layer: the SEALED ciphertext, base64'd, in the platform KV store
 * (localStorage on web, AsyncStorage on native). Surviving a reload means a
 * refresh no longer re-pulls the blob from the server — yet only ciphertext ever
 * touches disk, so E2EE-at-rest holds (bytes are still opened with the room key
 * on read). A blob is immutable (random id per upload), so a hit is never stale.
 * Bounded by a small byte budget with oldest-first eviction; an over-quota write
 * fails silently (kv swallows it) and simply isn't persisted.
 */
const PERSIST_PREFIX = 'octochat.attach.blob.';
const PERSIST_INDEX = 'octochat.attach.index';
const PERSIST_BUDGET_BYTES = 4 * 1024 * 1024;

type PersistIndex = { k: string; n: number }[];

function persistStoreKey(roomId: string, blobId: string): string {
  return `${PERSIST_PREFIX}${roomId}/${blobId}`;
}

async function readPersistIndex(): Promise<PersistIndex> {
  const raw = await kvGet(PERSIST_INDEX);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PersistIndex) : [];
  } catch {
    return [];
  }
}

async function persistGet(roomId: string, blobId: string): Promise<Uint8Array | null> {
  const b64 = await kvGet(persistStoreKey(roomId, blobId));
  if (!b64) return null;
  try {
    return getBase64().decode(b64);
  } catch {
    return null;
  }
}

async function persistPut(roomId: string, blobId: string, sealed: Uint8Array): Promise<void> {
  const storeKey = persistStoreKey(roomId, blobId);
  const b64 = getBase64().encode(sealed);
  const index = (await readPersistIndex()).filter((e) => e.k !== storeKey);
  index.push({ k: storeKey, n: b64.length });
  let total = index.reduce((s, e) => s + e.n, 0);
  // Evict oldest until within budget, but never the entry we just added (a single
  // oversized blob is simply kept on its own).
  while (total > PERSIST_BUDGET_BYTES && index.length > 1) {
    const victim = index.shift()!;
    if (victim.k === storeKey) {
      index.push(victim);
      continue;
    }
    await kvRemove(victim.k);
    total -= victim.n;
  }
  await kvSet(storeKey, b64);
  await kvSet(PERSIST_INDEX, JSON.stringify(index));
}

/** Images get a thumbnail; everything else renders as a file card. */
export function attachmentKind(mime: string): 'image' | 'file' {
  return mime.startsWith('image/') ? 'image' : 'file';
}

/** Seal bytes with the room key and store them as a blob; returns the message ref. */
export async function uploadAttachment(
  client: StarfishClient,
  enc: ByteSealer,
  roomId: string,
  bytes: Uint8Array,
  name: string,
  mime: string,
): Promise<AttachmentRef> {
  const blobId = randomBlobId();
  const sealed = await enc.sealBytes(bytes, attachmentName(roomId, blobId));
  await client.pushBlob(attachmentPush(roomId, blobId), sealed, 'application/octet-stream');
  // Seed both layers: the plaintext (in memory) so the sender's own attachment
  // renders without a round-trip, and the ciphertext (persisted) so it survives
  // a reload like any other blob.
  cachePut(cacheKey(roomId, blobId), bytes);
  await persistPut(roomId, blobId, sealed);
  return { blobId, name, mime, size: bytes.length, kind: attachmentKind(mime) };
}

/** Fetch + decrypt an attachment blob back to its original bytes. */
export async function loadAttachment(
  client: StarfishClient,
  enc: ByteSealer,
  roomId: string,
  ref: AttachmentRef,
): Promise<Uint8Array> {
  const key = cacheKey(roomId, ref.blobId);
  const hit = decryptedCache.get(key);
  if (hit) return hit;
  // Cold load: prefer persisted ciphertext (no network) over a server pull.
  let sealed = await persistGet(roomId, ref.blobId);
  if (!sealed) {
    const res = await client.pullBlob(attachmentPull(roomId, ref.blobId));
    sealed = new Uint8Array(res.data);
    await persistPut(roomId, ref.blobId, sealed);
  }
  const bytes = await enc.openBytes(sealed, attachmentName(roomId, ref.blobId));
  cachePut(key, bytes);
  return bytes;
}
