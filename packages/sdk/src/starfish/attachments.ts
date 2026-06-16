/**
 * OctoChat attachment layer, backed by the `objblob` collection
 * (`spaces/{spaceId}/objects/blobs/{blobId}`) via octospaces-sdk's
 * `createObjectBlobStore`. Blobs are keyed by SPACE (not room), sealed
 * client-side before upload, and cached in memory + KV for offline reads.
 *
 * Public API is kept stable (same names/types as the legacy attachment store)
 * so callers (use-room, examples, session-context) need no changes to imports.
 */
import {
  MAX_OBJECT_BLOB_BYTES,
  createObjectBlobStore,
  type ObjectBlobRef,
  type ObjectBlobStore,
  type ByteSealer,
  attachmentKind,
} from '@drakkar.software/octospaces-sdk';
import type { StarfishClient } from '@drakkar.software/starfish-client';

// ── Public re-exports (kept stable for callers) ────────────────────────────
export type { ByteSealer } from '@drakkar.software/octospaces-sdk';
export { attachmentKind } from '@drakkar.software/octospaces-sdk';

/** @deprecated Alias for `MAX_OBJECT_BLOB_BYTES` — use that instead. */
export const MAX_ATTACHMENT_BYTES = MAX_OBJECT_BLOB_BYTES;

/** Attachment reference stored on a message envelope.
 *  Extends `ObjectBlobRef` with the `kind` discriminant (image vs file). */
export interface AttachmentRef extends ObjectBlobRef {
  kind: 'image' | 'file';
}

export interface AttachmentStore {
  uploadAttachment(
    client: StarfishClient,
    enc: ByteSealer | null,
    spaceId: string,
    bytes: Uint8Array,
    name: string,
    mime: string,
  ): Promise<AttachmentRef>;
  loadAttachment(
    client: StarfishClient,
    enc: ByteSealer | null,
    spaceId: string,
    ref: AttachmentRef,
  ): Promise<Uint8Array>;
  clearAttachmentCache(): void;
}

// ── Singleton store (stable KV prefixes across the app) ───────────────────
const _objStore: ObjectBlobStore = createObjectBlobStore({
  persistPrefix: 'octochat.attach.blob.',
  persistIndex: 'octochat.attach.index',
});

export async function uploadAttachment(
  client: StarfishClient,
  enc: ByteSealer | null,
  spaceId: string,
  bytes: Uint8Array,
  name: string,
  mime: string,
): Promise<AttachmentRef> {
  const ref = await _objStore.uploadObjectBlob(client, enc, spaceId, bytes, name, mime);
  return { ...ref, kind: attachmentKind(mime) };
}

export async function loadAttachment(
  client: StarfishClient,
  enc: ByteSealer | null,
  spaceId: string,
  ref: AttachmentRef,
): Promise<Uint8Array> {
  return _objStore.loadObjectBlob(client, enc, spaceId, ref);
}

export function clearAttachmentCache(): void {
  _objStore.clearObjectBlobCache();
}
