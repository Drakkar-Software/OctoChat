/**
 * Decrypt-and-render lifecycle for an inline image attachment, with recovery.
 *
 * A blob fetch can fail transiently (a network drop, the server briefly
 * unreachable). The byte caches only ever store *successes* (see the SDK's
 * `loadAttachment`), so a failure never poisons them — yet a one-shot load would
 * still leave the thumbnail stuck on "couldn't load" until the row remounts. This
 * hook makes that state recoverable two ways:
 *  - {@link AttachmentImage.retry} — a manual re-attempt (wired to a tap on the
 *    failed placeholder).
 *  - an AUTOMATIC re-attempt when connectivity is restored, so a transient drop
 *    self-heals without the user noticing.
 *
 * It also owns the object-URL lifecycle (web) and the intrinsic-aspect measure,
 * so the component just consumes `{ uri, failed, ratio, retry }`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform } from 'react-native';
import { getBase64 } from '@drakkar.software/starfish-protocol';
import type { AttachmentRef } from '@drakkar.software/octochat-sdk';

import { subscribeOnline } from './connectivity';

/** Decrypted bytes → a renderable URI. Web uses an object URL; native a data URI. */
function bytesToUri(bytes: Uint8Array, mime: string): string {
  if (Platform.OS === 'web') return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  return `data:${mime};base64,${getBase64().encode(bytes)}`;
}

export interface AttachmentImage {
  /** Renderable URI once decrypted, else null (loading or failed). */
  uri: string | null;
  /** The load (network or decrypt) failed; show the retry placeholder. */
  failed: boolean;
  /** A manual/auto re-attempt is in flight — show a spinner so the tap visibly
   *  registers (the first load uses the shimmer skeleton instead). */
  retrying: boolean;
  /** Intrinsic aspect (height ÷ width), measured once the URI is ready. */
  ratio: number | null;
  /** Re-attempt the load (clears the failed state). */
  retry: () => void;
}

/**
 * Drive an image attachment's decrypt → URI lifecycle with retry on failure.
 *
 * @param attachment the ref to fetch + decrypt
 * @param enabled    only loads when true (skip for non-image attachments)
 * @param onLoad     fetch + decrypt the blob's bytes (room-bound by the caller)
 */
export function useAttachmentImage(
  attachment: AttachmentRef,
  enabled: boolean,
  onLoad?: (ref: AttachmentRef) => Promise<Uint8Array | null>,
): AttachmentImage {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ratio, setRatio] = useState<number | null>(null);
  // Bumped to force the load effect to re-run (manual retry / reconnect).
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setFailed(false);
    setUri(null);
    // Flip to loading synchronously with the tap so the spinner shows at once,
    // even before the effect's own attempt begins.
    setLoading(true);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !onLoad) return;
    let url: string | null = null;
    let cancelled = false;
    setFailed(false);
    setLoading(true);
    (async () => {
      try {
        const bytes = await onLoad(attachment);
        if (cancelled) return;
        if (!bytes) {
          setFailed(true);
          return;
        }
        url = bytesToUri(bytes, attachment.mime);
        setUri(url);
        // Measure the decrypted image so the inline thumbnail preserves aspect
        // within the width cap. Failure here just leaves the default ratio.
        Image.getSize(
          url,
          (w, h) => {
            if (!cancelled && w > 0) setRatio(h / w);
          },
          () => {},
        );
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (url && Platform.OS === 'web') URL.revokeObjectURL(url);
    };
  }, [attachment, enabled, onLoad, attempt]);

  // Auto-retry a failed load when connectivity returns, so a transient drop
  // self-heals. A ref keeps the subscription stable (no churn per render) while
  // still reading the latest failed state inside the callback.
  const failedRef = useRef(false);
  failedRef.current = failed;
  useEffect(() => {
    if (!enabled) return;
    return subscribeOnline((online) => {
      if (online && failedRef.current) retry();
    });
  }, [enabled, retry]);

  // `retrying` is reserved for re-attempts (attempt > 0) so the very first load
  // keeps the shimmer skeleton; a recovery attempt shows a spinner instead.
  return { uri, failed, retrying: loading && attempt > 0, ratio, retry };
}
