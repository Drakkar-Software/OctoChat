/**
 * OctoChat attachment layer, backed by the `objblob` collection
 * (`spaces/{spaceId}/objects/blobs/{blobId}`) via starfish-client's
 * `createSealedBlobStore`, fed dk-spaces-sdk's `objectBlobPaths` path/AAD
 * strategy. Blobs are keyed by SPACE (not room), sealed client-side before
 * upload, and cached in memory + KV for offline reads.
 *
 * Public API is kept stable (same names/types as the legacy attachment store)
 * so callers (use-room, examples, session-context) need no changes to imports.
 * dk-spaces-sdk 0.30 stopped wrapping the blob store — this module now builds
 * it directly and re-attaches the `name`/`mime`/`kind` metadata the new
 * generic store no longer tracks (its `upload`/`load` only take raw bytes + id).
 */
import { createSealedBlobStore, type ByteSealer } from '@drakkar.software/starfish-client';
import { objectBlobPaths, MAX_OBJECT_BLOB_BYTES, attachmentKind, type ObjectBlobRef, type BlobCtx } from '@drakkar.software/dk-spaces-sdk';
import { kvGet, kvSet, kvRemove } from '@drakkar.software/dk-spaces-sdk';
import type { StarfishClient } from '@drakkar.software/starfish-client';

// ── Public re-exports (kept stable for callers) ────────────────────────────
export type { ByteSealer } from '@drakkar.software/starfish-client';
export { attachmentKind } from '@drakkar.software/dk-spaces-sdk';

/** @deprecated Alias for `MAX_OBJECT_BLOB_BYTES` — use that instead. */
export const MAX_ATTACHMENT_BYTES = MAX_OBJECT_BLOB_BYTES;

/** Attachment reference stored on a message envelope.
 *  Extends `ObjectBlobRef` with the `kind` discriminant (image vs file).
 *
 *  `scope?: 'node'` marks blobs stored under the per-node prefix (`objnodeblob`).
 *  Absent means the legacy space-level `objblob` tier (backward compatible). */
export interface AttachmentRef extends ObjectBlobRef {
  kind: 'image' | 'file';
  scope?: 'node';
}

export interface AttachmentStore {
  uploadAttachment(
    client: StarfishClient,
    enc: ByteSealer | null,
    spaceId: string,
    bytes: Uint8Array,
    name: string,
    mime: string,
    nodeId?: string,
  ): Promise<AttachmentRef>;
  loadAttachment(
    client: StarfishClient,
    enc: ByteSealer | null,
    spaceId: string,
    ref: AttachmentRef,
    nodeId?: string,
  ): Promise<Uint8Array>;
  clearAttachmentCache(): void;
}

// ── Singleton store (stable KV prefixes across the app) ───────────────────
const _blobStore = createSealedBlobStore<BlobCtx>({
  paths: objectBlobPaths,
  maxBytes: MAX_OBJECT_BLOB_BYTES,
  kvAdapter: { getItem: kvGet, setItem: kvSet, removeItem: kvRemove },
  persistPrefix: 'octochat.attach.blob.',
  persistIndexKey: 'octochat.attach.index',
});

export async function uploadAttachment(
  client: StarfishClient,
  enc: ByteSealer | null,
  spaceId: string,
  bytes: Uint8Array,
  name: string,
  mime: string,
  nodeId?: string,
): Promise<AttachmentRef> {
  const blobId = await _blobStore.upload(client, enc, bytes, { spaceId, nodeId });
  return { blobId, name, mime, size: bytes.length, kind: attachmentKind(mime), ...(nodeId ? { scope: 'node' as const } : {}) };
}

export async function loadAttachment(
  client: StarfishClient,
  enc: ByteSealer | null,
  spaceId: string,
  ref: AttachmentRef,
  nodeId?: string,
): Promise<Uint8Array> {
  const resolvedNodeId = ref.scope === 'node' ? nodeId : undefined;
  return _blobStore.load(client, enc, ref.blobId, { spaceId, nodeId: resolvedNodeId });
}

export function clearAttachmentCache(): void {
  _blobStore.clearCache();
}
