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
import type { StarfishClient } from '@drakkar.software/starfish-client';

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
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
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
  return { blobId, name, mime, size: bytes.length, kind: attachmentKind(mime) };
}

/** Fetch + decrypt an attachment blob back to its original bytes. */
export async function loadAttachment(
  client: StarfishClient,
  enc: ByteSealer,
  roomId: string,
  ref: AttachmentRef,
): Promise<Uint8Array> {
  const res = await client.pullBlob(attachmentPull(roomId, ref.blobId));
  return enc.openBytes(new Uint8Array(res.data), attachmentName(roomId, ref.blobId));
}
