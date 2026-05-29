/**
 * Background push → real-content notification — web/default no-op.
 *
 * The real implementation is `background-notify.native.ts` (Metro resolves it on
 * iOS/Android). Web/desktop show their own toasts from the SSE stream via
 * `notify.ts`, so there is no background handler here.
 */
import type { PushData } from './fcm';

/** Handle a data-only background push: decrypt + display the real message. No-op on web. */
export async function handleBackgroundPush(_data: PushData): Promise<void> {}
