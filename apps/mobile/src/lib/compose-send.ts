/**
 * Shared send-orchestration logic for the room and thread Composer `onSend` callbacks.
 *
 * Why a separate module?
 *   The room screen and the thread screen share IDENTICAL orchestration: if a file
 *   is attached, upload it first; only call `send` when the ref is non-null (surface
 *   a failure instead of silently dropping the attachment); attachment-only sends
 *   (empty text) are valid; text-only sends go through `sendText` (which routes
 *   through the offline outbox). Extracting this ensures both screens can't drift and
 *   the logic is unit-testable without React.
 */

import type { AttachmentRef } from '@drakkar.software/octochat-sdk';

export interface ComposeSendFile {
  bytes: Uint8Array;
  name: string;
  mime: string;
}

export interface ComposeSendResult {
  /** Whether the send was attempted (false = attachment upload failed). */
  ok: boolean;
  /** Set when the attachment upload returned null (client not ready or network error). */
  attachmentFailed?: true;
}

export interface ComposeSendOptions {
  text: string;
  file?: ComposeSendFile | null;
  parentId?: string;
  uploadAttachment: (bytes: Uint8Array, name: string, mime: string) => Promise<AttachmentRef | null>;
  send: (text: string, parentId?: string, attachment?: AttachmentRef) => unknown;
  sendText: (text: string) => unknown;
}

/**
 * Orchestrate one Composer submit: upload → send or sendText.
 *
 * Invariants:
 * - File present → upload; only call `send` when ref is non-null (never silently drop).
 * - File absent, text present → `sendText` (offline outbox path).
 * - File present, text empty → attachment-only send (empty string); `send` is still
 *   called so long as the upload succeeds.
 * - Returns `{ ok: false, attachmentFailed: true }` when the upload returned null so
 *   the caller can surface an error rather than silently no-op.
 */
export async function composeSend({
  text,
  file,
  parentId,
  uploadAttachment,
  send,
  sendText,
}: ComposeSendOptions): Promise<ComposeSendResult> {
  if (file) {
    const ref = await uploadAttachment(file.bytes, file.name, file.mime);
    if (!ref) {
      // Upload failed (client not ready or network error) — do NOT call send with
      // undefined so the message appears sent without its attachment. Surface failure.
      return { ok: false, attachmentFailed: true };
    }
    send(text, parentId, ref);
    return { ok: true };
  }
  // Text-only: route through sendText (offline outbox).
  await sendText(text);
  return { ok: true };
}
