/**
 * {@link SpaceAccessError} — a GENUINE access denial (you're not on the keyring / not a
 * member / the space has no keyring yet), as opposed to a transient connectivity failure.
 *
 * Lives in its own dependency-free module so BOTH the low-level keyring opener
 * (`client.ts`) and the higher-level space-encryptor cache (`space-encryptor.ts`) can
 * throw it without an import cycle (space-encryptor imports from client, so client can't
 * import back from space-encryptor). The room-open path classifies on it by `instanceof`:
 * a `SpaceAccessError` is surfaced as a hard, user-facing `openError` (e.g. the DM
 * screen's "Open this DM on your primary device" notice), while any OTHER thrown error is
 * treated as a transient offline state (banner + pending bubbles still render).
 */
export class SpaceAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpaceAccessError';
  }
}
