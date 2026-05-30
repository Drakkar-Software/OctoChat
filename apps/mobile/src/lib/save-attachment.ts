/**
 * Save a decrypted attachment to the user's device — web/default implementation.
 *
 * Builds an object URL from the bytes and clicks a hidden `<a download>`, the
 * browser's native "save file" flow. The native (iOS/Android) counterpart is
 * `save-attachment.native.ts` — it writes the bytes to a cache file and opens
 * the OS share sheet (Metro resolves it on those platforms). The two exports
 * keep an identical signature so the single call site typechecks on every
 * platform.
 */
export async function saveAttachment(bytes: Uint8Array, name: string, mime: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // Revoke after a tick — revoking synchronously can cancel the download in some
  // browsers before the navigation to the blob URL has been processed.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
